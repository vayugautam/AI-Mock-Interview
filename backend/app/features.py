"""Content feature extraction for candidate answers (similarity, concept coverage, length, STAR)."""

from __future__ import annotations

import math
import re
from typing import Any, Iterable, Optional

from app import rag

CONCEPT_SIMILARITY_THRESHOLD = 0.55

_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "by",
        "for",
        "from",
        "in",
        "into",
        "is",
        "it",
        "of",
        "on",
        "or",
        "that",
        "the",
        "to",
        "vs",
        "with",
    }
)

_IRREGULAR_LEMMAS: dict[str, str] = {
    "anomalies": "anomaly",
    "dependencies": "dependency",
    "entries": "entry",
    "indices": "index",
    "indexes": "index",
    "queries": "query",
    "tables": "table",
    "keys": "key",
    "values": "value",
    "redundancies": "redundancy",
    "redundant": "redundancy",
    "atomic": "atomicity",
    "normalized": "normal",
    "normalizing": "normal",
    "normalization": "normal",
    "normalisation": "normal",
    "transitive": "transitiv",
    "partial": "partial",
    "partially": "partial",
    "reducing": "reduc",
    "reduction": "reduc",
    "reduce": "reduc",
    "reduces": "reduc",
    "removing": "remov",
    "removal": "remov",
    "remove": "remov",
    "eliminating": "eliminat",
    "elimination": "eliminat",
}

_STAR_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "situation": [
        re.compile(
            r"(?i)\b(?:when|while|during|at my|in my|last (?:year|semester|summer)|"
            r"on a (?:project|team)|our team was|we were (?:working|building|facing)|"
            r"context|background|situation|project where)\b"
        ),
    ],
    "task": [
        re.compile(
            r"(?i)\b(?:my (?:role|task|goal|objective|responsibility)|"
            r"i was (?:responsible|tasked|assigned|asked)|i had to|i needed to|"
            r"challenge was|goal was|tight deadline|expected to)\b"
        ),
    ],
    "action": [
        re.compile(
            r"(?i)\b(?:i (?:built|designed|implemented|created|led|organized|refactored|"
            r"debugged|profiled|investigated|diagnosed|proposed|wrote|set up|added|fixed|"
            r"configured|coordinated|communicated|collaborated|paired|analyzed|benchmarked|"
            r"measured|monitored|resolved|prioritized|automated|tested|reviewed|migrated|"
            r"optimized|deployed|documented|introduced|mentored|talked|discussed|"
            r"facilitated|decided|worked|started by|took ownership|stepped in)|"
            r"my approach|steps i took|so i)\b"
        ),
    ],
    "result": [
        re.compile(
            r"(?i)\b(?:as a result|resulted in|outcome|ultimately|in the end|"
            r"reduced|improved|increased|dropped by|saved|delivered|shipped|achieved|"
            r"succeeded|successfully|on time|learned|takeaway|percent)\b"
        ),
        re.compile(r"\b\d+(?:\.\d+)?\s*%"),
    ],
}


def _clamp01(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 4)


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _simple_lemma(token: str) -> str:
    """Lightweight English lemmatizer/normalizer without external NLP downloads."""
    t = token.lower().strip()
    if t in _IRREGULAR_LEMMAS:
        return _IRREGULAR_LEMMAS[t]
    if len(t) > 5 and t.endswith("ies"):
        return t[:-3] + "y"
    for suffix in ("ation", "tion", "ment", "ness", "ing", "ed", "es", "ly", "s"):
        if len(t) - len(suffix) >= 3 and t.endswith(suffix):
            return t[: -len(suffix)]
    return t


def _tokenize_lemmas(text: str) -> set[str]:
    raw_tokens = re.findall(r"[a-z0-9]+", text.lower())
    return {_simple_lemma(tok) for tok in raw_tokens if tok and tok not in _STOPWORDS}


def _split_sentences(text: str) -> list[str]:
    parts = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text.strip()) if s.strip()]
    return parts if parts else ([text.strip()] if text.strip() else [])


def _extract_reference_text(reference_chunk: Any) -> str:
    if reference_chunk is None:
        return ""
    if isinstance(reference_chunk, str):
        return reference_chunk.strip()
    if isinstance(reference_chunk, dict):
        ref = reference_chunk.get("reference_answer") or reference_chunk.get("text") or ""
        return str(ref).strip()
    return str(
        getattr(reference_chunk, "reference_answer", getattr(reference_chunk, "text", ""))
    ).strip()


def _keyword_or_lemma_match(concept: str, answer_lower: str, answer_lemmas: set[str]) -> bool:
    norm_concept = " ".join(concept.lower().split())
    if not norm_concept:
        return False

    # 1. Direct word-boundary substring match
    if re.search(r"(?<!\w)" + re.escape(norm_concept) + r"(?!\w)", answer_lower):
        return True

    # 2. Significant lemmatized tokens all present in answer
    concept_tokens = [
        tok for tok in re.findall(r"[a-z0-9]+", norm_concept) if tok not in _STOPWORDS
    ]
    if not concept_tokens:
        return False
    concept_lemmas = {_simple_lemma(tok) for tok in concept_tokens}
    return concept_lemmas.issubset(answer_lemmas)


def _compute_length_score(word_count: int, interview_type: str) -> float:
    """Compute 0-1 length score peaking at 60-200 words (technical) or 80-250 (behavioural)."""
    if word_count <= 0:
        return 0.0

    is_behavioural = interview_type.strip().lower() == "behavioural"
    min_ideal = 80.0 if is_behavioural else 60.0
    max_ideal = 250.0 if is_behavioural else 200.0

    if min_ideal <= word_count <= max_ideal:
        return 1.0

    if word_count < min_ideal:
        # Super-linear curve penalizes very short answers more strongly
        ratio = word_count / min_ideal
        return _clamp01(ratio**1.5)

    # Gentle decay for overly long answers down to a 0.4 floor at 2 * max_ideal
    excess_ratio = (word_count - max_ideal) / max_ideal
    return _clamp01(max(0.4, 1.0 - 0.6 * excess_ratio))


def _detect_star_structure(cleaned_answer: str) -> dict[str, Any]:
    """Detect presence of Situation, Task, Action, and Result components in behavioural answers."""
    components: dict[str, bool] = {}
    for key, patterns in _STAR_PATTERNS.items():
        components[key] = any(p.search(cleaned_answer) is not None for p in patterns)

    present_count = sum(1 for present in components.values() if present)
    return {
        "score": _clamp01(present_count / 4.0),
        "components": components,
    }


def content_features(
    question: str,
    cleaned_answer: str,
    reference_chunk: Any,
    expected_concepts: Iterable[str],
    interview_type: str,
) -> dict[str, Any]:
    """Extract normalized 0-1 content features for a candidate's cleaned answer.

    Returns a fixed-schema dict:
        {
            "sim_question": float,
            "sim_reference": float,
            "concept_coverage": float,
            "concepts_covered": list[str],
            "word_count": int,
            "length_score": float,
            "star_structure": dict | None,
        }
    """
    answer_text = (cleaned_answer or "").strip()
    question_text = (question or "").strip()
    reference_text = _extract_reference_text(reference_chunk)
    concepts = [str(c).strip() for c in (expected_concepts or []) if str(c).strip()]
    norm_type = (interview_type or "technical").strip().lower()

    word_count = len(re.findall(r"\b[\w'-]+\b", answer_text))
    length_score = _compute_length_score(word_count, norm_type)
    star_structure = (
        _detect_star_structure(answer_text) if norm_type == "behavioural" else None
    )

    if not answer_text:
        return {
            "sim_question": 0.0,
            "sim_reference": 0.0,
            "concept_coverage": 0.0,
            "concepts_covered": [],
            "word_count": 0,
            "length_score": 0.0,
            "star_structure": star_structure,
        }

    answer_vec = rag.embed(answer_text)
    sim_question = (
        _clamp01(_cosine_similarity(answer_vec, rag.embed(question_text)))
        if question_text
        else 0.0
    )
    sim_reference = (
        _clamp01(_cosine_similarity(answer_vec, rag.embed(reference_text)))
        if reference_text
        else 0.0
    )

    # Concept coverage: keyword/lemma match OR sentence-level embedding cosine >= 0.55
    concepts_covered: list[str] = []
    if concepts:
        answer_lower = answer_text.lower()
        answer_lemmas = _tokenize_lemmas(answer_text)
        sentences = _split_sentences(answer_text)
        sentence_vecs: Optional[list[list[float]]] = None

        for concept in concepts:
            if _keyword_or_lemma_match(concept, answer_lower, answer_lemmas):
                concepts_covered.append(concept)
                continue

            if sentence_vecs is None:
                sentence_vecs = [rag.embed(sent) for sent in sentences]
            concept_vec = rag.embed(concept)
            best_sent_sim = max(
                (_cosine_similarity(concept_vec, s_vec) for s_vec in sentence_vecs),
                default=0.0,
            )
            if best_sent_sim >= CONCEPT_SIMILARITY_THRESHOLD:
                concepts_covered.append(concept)

        concept_coverage = _clamp01(len(concepts_covered) / len(concepts))
    else:
        concept_coverage = 0.0

    return {
        "sim_question": sim_question,
        "sim_reference": sim_reference,
        "concept_coverage": concept_coverage,
        "concepts_covered": concepts_covered,
        "word_count": word_count,
        "length_score": length_score,
        "star_structure": star_structure,
    }


def _demo_dbms_table() -> None:
    """Print a compact comparison table across 4 DBMS normalization answers."""
    question = "Explain database normalization and the goals of 1NF, 2NF, and 3NF."
    reference = (
        "Normalization organizes relational tables to reduce data redundancy and prevent "
        "insert, update, and delete anomalies. 1NF enforces atomic values and no repeating "
        "groups; 2NF removes partial dependencies on composite primary keys; 3NF removes "
        "transitive dependencies so non-key attributes depend solely on the primary key."
    )
    concepts = [
        "redundancy reduction",
        "update anomalies",
        "1NF atomic values",
        "2NF partial dependency",
        "3NF transitive dependency",
    ]
    samples = [
        (
            "Strong",
            (
                "Database normalization is the process of structuring relational tables to reduce "
                "data redundancy and prevent insert, update, and delete anomalies. First Normal Form "
                "(1NF) requires every column to hold atomic values with no repeating groups. Second "
                "Normal Form (2NF) builds on 1NF by removing partial dependencies so every non-key "
                "attribute depends on the full composite primary key. Third Normal Form (3NF) goes "
                "further by eliminating transitive dependencies, ensuring non-key columns depend "
                "only on the primary key and not on other non-key attributes."
            ),
        ),
        (
            "Average",
            (
                "Normalization is used in DBMS to split large tables into smaller ones so we do not "
                "repeat the same data everywhere and avoid update anomalies. In 1NF, each cell must "
                "store a single atomic value. In 2NF and 3NF, we remove extra dependencies between "
                "columns so tables stay clean and consistent when records change."
            ),
        ),
        (
            "Weak",
            "Normalization splits database tables so there is less duplicate data.",
        ),
        (
            "Off-topic",
            (
                "To train a convolutional neural network effectively, I tune the learning rate, "
                "apply data augmentation like random crops, and monitor validation loss to prevent "
                "overfitting across epochs."
            ),
        ),
    ]

    header = (
        f"{'Tier':<10} | {'SimQ':>6} | {'SimRef':>6} | {'Cov':>6} | "
        f"{'Words':>5} | {'LenSc':>6} | {'Concepts Covered'}"
    )
    print(header)
    print("-" * len(header) + "--------------------")
    for tier, ans in samples:
        feats = content_features(question, ans, reference, concepts, "technical")
        print(
            f"{tier:<10} | {feats['sim_question']:>6.3f} | {feats['sim_reference']:>6.3f} | "
            f"{feats['concept_coverage']:>6.3f} | {feats['word_count']:>5d} | "
            f"{feats['length_score']:>6.3f} | {', '.join(feats['concepts_covered']) or '-'}"
        )


if __name__ == "__main__":
    _demo_dbms_table()
