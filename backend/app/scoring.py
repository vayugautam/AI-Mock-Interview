"""Rubric criterion weights, answer/session scoring, and tunable performance bands."""

from __future__ import annotations

from typing import Iterable, Mapping

# Single source of truth for per-rubric criterion weights (each rubric sums to 1.0).
WEIGHTS: dict[str, dict[str, float]] = {
    "technical": {
        "technical_correctness": 0.35,
        "relevance": 0.20,
        "clarity": 0.15,
        "completeness": 0.20,
        "communication": 0.10,
    },
    "behavioural": {
        "star_structure": 0.30,
        "relevance": 0.20,
        "clarity": 0.15,
        "completeness": 0.25,
        "communication": 0.10,
    },
}

# Backwards-compatible alias used by earlier modules/tests
CRITERION_WEIGHTS = WEIGHTS

# Lower-bound score thresholds (inclusive, 0-10 scale) for performance bands.
# Tune these thresholds on your validation set as needed.
BAND_THRESHOLDS: dict[str, float] = {
    "Excellent": 8.0,
    "Good": 6.0,
    "Satisfactory": 4.0,
    "Needs Improvement": 0.0,
}


def get_criterion_weights(interview_type: str) -> dict[str, float]:
    """Return the criterion weight mapping for `technical` or `behavioural`."""
    rubric = interview_type.strip().lower()
    if rubric not in WEIGHTS:
        raise ValueError(
            f"Unsupported interview_type '{interview_type}'. "
            f"Expected one of: {', '.join(sorted(WEIGHTS))}."
        )
    return WEIGHTS[rubric]


def answer_score(
    scores: Mapping[str, int | float],
    interview_type: str,
) -> float:
    """Compute a backend weighted answer score (0-10) from per-criterion rubric scores."""
    weights = get_criterion_weights(interview_type)
    missing = [key for key in weights if key not in scores]
    if missing:
        raise ValueError(f"Missing criterion scores for '{interview_type}': {missing}")

    weighted_sum = sum(float(scores[key]) * weight for key, weight in weights.items())
    return round(max(0.0, min(10.0, weighted_sum)), 4)


# Backwards-compatible alias
compute_weighted_llm_score = answer_score


def session_score(answer_scores: Iterable[float]) -> float:
    """Compute the mean session score across all answered questions, rounded to 1 decimal."""
    values = [float(s) for s in answer_scores]
    if not values:
        return 0.0
    mean_val = sum(values) / len(values)
    return round(max(0.0, min(10.0, mean_val)), 1)


def band(score: float) -> str:
    """Map a 0-10 score to its performance band using `BAND_THRESHOLDS`.

    Default bands:
      - < 4.0  -> "Needs Improvement"
      - 4-<6   -> "Satisfactory"
      - 6-<8   -> "Good"
      - >= 8.0 -> "Excellent"
    """
    numeric = float(score)
    for label, min_threshold in sorted(
        BAND_THRESHOLDS.items(),
        key=lambda item: item[1],
        reverse=True,
    ):
        if numeric >= min_threshold:
            return label
    return "Needs Improvement"
