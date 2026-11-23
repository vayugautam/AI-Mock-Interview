"""Feature-level and decision-level score fusion strategies (0-10 scale)."""

from __future__ import annotations

from typing import Any, Mapping, Optional

from app import scoring
from app.config import settings

VALID_FUSION_METHODS = ("feature_level", "decision_level")

DEFAULT_DECISION_WEIGHTS: dict[str, float] = {
    "llm": 0.6,
    "content": 0.3,
    "delivery": 0.1,
}


def _clamp10(value: float) -> float:
    return round(max(0.0, min(10.0, value)), 4)


def compute_content_score(sim_reference: float, concept_coverage: float) -> float:
    """Compute the 0-10 content score: (0.5 * sim_reference + 0.5 * concept_coverage) * 10."""
    sim = max(0.0, min(1.0, float(sim_reference)))
    cov = max(0.0, min(1.0, float(concept_coverage)))
    return _clamp10((0.5 * sim + 0.5 * cov) * 10.0)


def compute_delivery_score(delivery_features: Optional[Mapping[str, Any]]) -> Optional[float]:
    """Compute the 0-10 delivery score as the mean of normalized delivery features * 10."""
    if not delivery_features:
        return None
    normalized = delivery_features.get("normalized")
    if not isinstance(normalized, Mapping) or not normalized:
        return None
    values = [float(v) for v in normalized.values() if isinstance(v, (int, float))]
    if not values:
        return None
    return _clamp10((sum(values) / len(values)) * 10.0)


def _resolve_criterion_weights(
    scores: Mapping[str, Any],
    weights: Mapping[str, Any],
) -> Mapping[str, float]:
    """Accept either a flat criterion weight dict or nested `scoring.WEIGHTS`."""
    if "technical" in weights and "behavioural" in weights and isinstance(
        weights["technical"], Mapping
    ):
        if "star_structure" in scores:
            return weights["behavioural"]
        if "technical_correctness" in scores:
            return weights["technical"]
        raise ValueError("Cannot infer rubric type from scores keys")
    return weights


def feature_level(
    llm_result: Mapping[str, Any],
    weights: Optional[Mapping[str, Any]] = None,
) -> float:
    """Compute the 0-10 feature-level fused score from the evaluator's criterion scores.

    Because the LLM evaluator already received content + delivery features in its prompt,
    feature-level fusion is the weighted average of the criterion scores using `scoring.WEIGHTS`.
    """
    scores = llm_result["scores"] if "scores" in llm_result and isinstance(llm_result["scores"], Mapping) else llm_result
    weight_map = _resolve_criterion_weights(scores, weights if weights is not None else scoring.WEIGHTS)

    missing = [key for key in weight_map if key not in scores]
    if missing:
        raise ValueError(f"Missing criterion scores for feature-level fusion: {missing}")

    total_weight = sum(float(w) for w in weight_map.values())
    if total_weight <= 0.0:
        raise ValueError("Criterion weights must sum to a positive value")

    weighted_sum = sum(float(scores[key]) * float(w) for key, w in weight_map.items())
    return _clamp10(weighted_sum / total_weight)


def decision_level(
    llm_score: float,
    sim_reference: float,
    concept_coverage: float,
    delivery_score_or_None: Optional[float | Mapping[str, Any]],
    w: Optional[Mapping[str, float]] = None,
) -> float:
    """Compute the 0-10 decision-level fused score across LLM, content, and delivery signals.

    - `content_score` = (0.5 * sim_reference + 0.5 * concept_coverage) * 10
    - `delivery_score` = float (0-10) or derived from `delivery_features['normalized']` * 10
    - When delivery is None (typed answers), remaining weights (`llm`, `content`) are renormalized.
    - Default weights: `{"llm": 0.6, "content": 0.3, "delivery": 0.1}`.
    """
    weights = dict(DEFAULT_DECISION_WEIGHTS if w is None else w)
    w_llm = float(weights.get("llm", 0.0))
    w_content = float(weights.get("content", 0.0))
    w_delivery = float(weights.get("delivery", 0.0))

    content_score = compute_content_score(sim_reference, concept_coverage)

    if isinstance(delivery_score_or_None, Mapping):
        delivery_score = compute_delivery_score(delivery_score_or_None)
    elif delivery_score_or_None is None:
        delivery_score = None
    else:
        delivery_score = _clamp10(float(delivery_score_or_None))

    if delivery_score is None:
        denom = w_llm + w_content
        if denom <= 0.0:
            raise ValueError("Remaining decision-level weights (llm + content) must be positive")
        fused = (w_llm / denom) * float(llm_score) + (w_content / denom) * content_score
        return _clamp10(fused)

    denom = w_llm + w_content + w_delivery
    if denom <= 0.0:
        raise ValueError("Decision-level weights must sum to a positive value")

    fused = (
        (w_llm / denom) * float(llm_score)
        + (w_content / denom) * content_score
        + (w_delivery / denom) * delivery_score
    )
    return _clamp10(fused)


def fuse_evaluation_scores(
    llm_result: Mapping[str, Any],
    interview_type: str,
    sim_reference: float,
    concept_coverage: float,
    delivery_features_or_None: Optional[Mapping[str, Any]],
    *,
    fusion_method: Optional[str] = None,
    decision_weights: Optional[Mapping[str, float]] = None,
) -> dict[str, Any]:
    """Compute both fusion strategies and select the active `fused_score` via `FUSION_METHOD`."""
    chosen = (fusion_method or settings.FUSION_METHOD).strip().lower()
    if chosen not in VALID_FUSION_METHODS:
        raise ValueError(
            f"Unsupported fusion_method '{chosen}'. Expected one of {VALID_FUSION_METHODS}."
        )

    rubric_weights = scoring.get_criterion_weights(interview_type)
    feat_score = feature_level(llm_result, rubric_weights)
    content_score = compute_content_score(sim_reference, concept_coverage)
    delivery_score = compute_delivery_score(delivery_features_or_None)
    dec_score = decision_level(
        llm_score=feat_score,
        sim_reference=sim_reference,
        concept_coverage=concept_coverage,
        delivery_score_or_None=delivery_score,
        w=decision_weights,
    )

    method_scores = {
        "feature_level": feat_score,
        "decision_level": dec_score,
    }
    return {
        "llm_score": feat_score,
        "similarity_score": content_score,
        "delivery_score": delivery_score,
        "fused_score": method_scores[chosen],
        "fusion_method": chosen,
        "method_scores": method_scores,
    }
