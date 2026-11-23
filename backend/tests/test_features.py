"""Unit tests for app/features.py with 4 ordered DBMS sample answers and behavioural STAR checks.

Run as pytest:
    pytest tests/test_features.py -v

Run as a script to print the score comparison table:
    python -m tests.test_features
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.features import content_features

DBMS_QUESTION = "Explain database normalization and the goals of 1NF, 2NF, and 3NF."
DBMS_REFERENCE_CHUNK = {
    "topic": "dbms",
    "reference_answer": (
        "Normalization organizes relational tables to reduce data redundancy and prevent "
        "insert, update, and delete anomalies. 1NF enforces atomic values and no repeating "
        "groups; 2NF removes partial dependencies on composite primary keys; 3NF removes "
        "transitive dependencies so non-key attributes depend solely on the primary key."
    ),
    "expected_concepts": [
        "redundancy reduction",
        "update anomalies",
        "1NF atomic values",
        "2NF partial dependency",
        "3NF transitive dependency",
    ],
}

DBMS_SAMPLES: list[tuple[str, str]] = [
    (
        "strong",
        (
            "Database normalization is the systematic design of relational tables to reduce data "
            "redundancy and prevent insert, update, and delete anomalies. First Normal Form (1NF) "
            "requires every column to hold atomic values with no repeating groups. Second Normal "
            "Form (2NF) removes partial dependencies so every non-key attribute depends on the "
            "entire composite primary key. Third Normal Form (3NF) eliminates transitive "
            "dependencies so non-key columns depend strictly on the primary key and not on other "
            "non-key attributes, keeping schemas consistent."
        ),
    ),
    (
        "average",
        (
            "Normalization in a DBMS divides big tables into smaller related tables to cut down "
            "redundant data and avoid update anomalies. In 1NF every field should have atomic "
            "values rather than lists. In 2NF and 3NF we separate columns that depend on other "
            "columns so updating one record does not create inconsistent rows."
        ),
    ),
    (
        "weak",
        "Normalization means splitting tables so there is less duplicate data in the database.",
    ),
    (
        "off-topic",
        (
            "When baking sourdough bread at home, I feed the starter with warm water and flour, "
            "let the dough ferment overnight, and preheat a Dutch oven to get a crispy crust."
        ),
    ),
]


def evaluate_dbms_samples() -> dict[str, dict]:
    results: dict[str, dict] = {}
    for label, answer in DBMS_SAMPLES:
        results[label] = content_features(
            question=DBMS_QUESTION,
            cleaned_answer=answer,
            reference_chunk=DBMS_REFERENCE_CHUNK,
            expected_concepts=DBMS_REFERENCE_CHUNK["expected_concepts"],
            interview_type="technical",
        )
    return results


def print_results_table(results: dict[str, dict]) -> None:
    header = (
        f"{'Sample':<10} | {'sim_q':>6} | {'sim_ref':>7} | {'cov':>6} | "
        f"{'words':>5} | {'len_sc':>6} | {'covered'}"
    )
    print(header)
    print("-" * len(header) + "----------------------")
    for label, _ in DBMS_SAMPLES:
        f = results[label]
        print(
            f"{label:<10} | {f['sim_question']:>6.3f} | {f['sim_reference']:>7.3f} | "
            f"{f['concept_coverage']:>6.3f} | {f['word_count']:>5d} | "
            f"{f['length_score']:>6.3f} | {', '.join(f['concepts_covered']) or '-'}"
        )


def test_dbms_four_sample_answers_ordered_sensibly() -> None:
    results = evaluate_dbms_samples()
    expected_keys = {
        "sim_question",
        "sim_reference",
        "concept_coverage",
        "concepts_covered",
        "word_count",
        "length_score",
        "star_structure",
    }

    for feats in results.values():
        assert set(feats.keys()) == expected_keys
        assert 0.0 <= feats["sim_question"] <= 1.0
        assert 0.0 <= feats["sim_reference"] <= 1.0
        assert 0.0 <= feats["concept_coverage"] <= 1.0
        assert 0.0 <= feats["length_score"] <= 1.0
        assert feats["star_structure"] is None

    strong = results["strong"]
    average = results["average"]
    weak = results["weak"]
    off_topic = results["off-topic"]

    # Reference similarity strictly ordered: strong > average > weak > off-topic
    assert strong["sim_reference"] > average["sim_reference"]
    assert average["sim_reference"] > weak["sim_reference"]
    assert weak["sim_reference"] > off_topic["sim_reference"]

    # Question similarity separates on-topic answers clearly from off-topic
    assert strong["sim_question"] > off_topic["sim_question"]
    assert average["sim_question"] > off_topic["sim_question"]

    # Concept coverage ordered: strong >= average > weak >= off-topic, and off-topic covers 0
    assert strong["concept_coverage"] == 1.0
    assert strong["concept_coverage"] > average["concept_coverage"]
    assert average["concept_coverage"] > weak["concept_coverage"]
    assert off_topic["concept_coverage"] == 0.0

    # Length score peaks for strong (>= 60 words) and strongly penalizes short weak answer
    assert strong["length_score"] == 1.0
    assert strong["length_score"] > weak["length_score"]
    assert weak["length_score"] < 0.25


def test_behavioural_star_structure_and_length_window() -> None:
    star_answer = (
        "During my final-year capstone project last semester, our backend API started timing out "
        "under concurrent user load two days before the faculty evaluation demo. My responsibility "
        "was to diagnose the root cause of the bottleneck and stabilize response latency before the "
        "Friday deadline. I profiled the slow PostgreSQL queries with EXPLAIN ANALYZE, added "
        "targeted composite indexes, and implemented Redis caching for frequent lookups while "
        "coordinating automated load tests with my teammate. As a result, p95 response latency "
        "dropped by 75% and we delivered the full demo on time without any errors."
    )
    feats = content_features(
        question="Tell me about a time you solved a tough performance problem under a deadline.",
        cleaned_answer=star_answer,
        reference_chunk="Use STAR: frame Situation/Task, detail Action taken, and quantify Result.",
        expected_concepts=["root cause analysis", "concrete action", "quantified result"],
        interview_type="behavioural",
    )

    assert feats["star_structure"] is not None
    assert feats["star_structure"]["score"] == 1.0
    assert feats["star_structure"]["components"] == {
        "situation": True,
        "task": True,
        "action": True,
        "result": True,
    }
    assert feats["word_count"] >= 80
    assert feats["length_score"] == 1.0

    # Partial behavioural answer missing explicit Task and Result scores below 1.0
    partial = content_features(
        question="Tell me about a time you solved a tough performance problem under a deadline.",
        cleaned_answer="During a hackathon I debugged a slow script with my friend.",
        reference_chunk="Use STAR: frame Situation/Task, detail Action taken, and quantify Result.",
        expected_concepts=["root cause analysis", "concrete action", "quantified result"],
        interview_type="behavioural",
    )
    assert partial["star_structure"] is not None
    assert partial["star_structure"]["score"] < feats["star_structure"]["score"]
    assert partial["length_score"] < feats["length_score"]


if __name__ == "__main__":
    print_results_table(evaluate_dbms_samples())
