import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ReferenceMaterial:
    topic: str
    question_patterns: tuple[str, ...]
    reference_answer: str
    key_concepts: tuple[str, ...]
    rubric: str


@dataclass(frozen=True)
class RetrievedContext:
    topic: str
    reference_answer: str
    key_concepts: tuple[str, ...]
    rubric: str
    score: int


REFERENCE_MATERIAL: tuple[ReferenceMaterial, ...] = (
    ReferenceMaterial(
        "data structures and algorithms",
        ("algorithm", "complexity", "data structure", "binary search", "array", "tree"),
        "A strong answer states the approach, explains correctness, and gives time and space complexity.",
        ("approach", "correctness", "time complexity", "space complexity"),
        "Reward a correct approach, complexity analysis, edge cases, and a concise explanation.",
    ),
    ReferenceMaterial(
        "databases",
        ("database", "sql", "index", "transaction", "normalization", "query"),
        "A strong database answer connects the requested behavior to data modeling, indexes, transactions, and trade-offs.",
        ("data modeling", "indexes", "transactions", "trade-offs"),
        "Reward accurate database semantics, appropriate trade-offs, and operational considerations.",
    ),
    ReferenceMaterial(
        "operating systems",
        ("operating system", "process", "thread", "deadlock", "memory", "scheduling"),
        "A strong operating systems answer defines the mechanism, explains its lifecycle, and discusses relevant trade-offs.",
        ("mechanism", "lifecycle", "concurrency", "trade-offs"),
        "Reward correct system behavior, terminology, and a concrete example or trade-off.",
    ),
    ReferenceMaterial(
        "web development",
        ("api", "http", "web", "rest", "frontend", "backend", "javascript"),
        "A strong web answer explains the request flow, boundaries, failure handling, and security implications.",
        ("request flow", "boundaries", "failure handling", "security"),
        "Reward accurate protocol or architecture details and practical reliability considerations.",
    ),
    ReferenceMaterial(
        "object-oriented programming",
        ("object", "class", "inheritance", "polymorphism", "encapsulation", "solid"),
        "A strong OOP answer defines the concept and shows when it improves maintainability with a concrete example.",
        ("definition", "maintainability", "example", "trade-offs"),
        "Reward precise definitions, appropriate use, and awareness of design trade-offs.",
    ),
    ReferenceMaterial(
        "ai and machine learning",
        ("machine learning", "model", "training", "overfitting", "classification", "embedding"),
        "A strong ML answer explains the learning objective, data considerations, evaluation, and common failure modes.",
        ("objective", "data", "evaluation", "failure modes"),
        "Reward technically accurate reasoning about data, modeling, evaluation, and limitations.",
    ),
)


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def retrieve_reference_material(question_text: str, *, limit: int = 1) -> list[RetrievedContext]:
    if limit < 1:
        return []
    question_tokens = _tokens(question_text)
    ranked: list[tuple[int, ReferenceMaterial]] = []
    for material in REFERENCE_MATERIAL:
        pattern_tokens = set().union(*(_tokens(pattern) for pattern in material.question_patterns))
        score = len(question_tokens & pattern_tokens)
        if score:
            ranked.append((score, material))
    ranked.sort(key=lambda item: (-item[0], item[1].topic))
    return [
        RetrievedContext(
            topic=material.topic,
            reference_answer=material.reference_answer,
            key_concepts=material.key_concepts,
            rubric=material.rubric,
            score=score,
        )
        for score, material in ranked[:limit]
    ]
