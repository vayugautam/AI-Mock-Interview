"""Pytest suite for knowledge base CSV integrity, idempotent Qdrant ingestion, and RAG retrieval."""

from __future__ import annotations

from qdrant_client import QdrantClient

from app.rag import (
    DEFAULT_KB_DIR,
    EMBEDDING_DIM,
    KB_COLLECTION_NAME,
    embed,
    get_reference_for_question,
    load_kb_rows,
    retrieve,
    sample_bank_question,
)
from scripts.ingest_kb import ingest_kb


def test_seed_kb_csv_counts_and_schema() -> None:
    rows = load_kb_rows(DEFAULT_KB_DIR)
    by_topic: dict[str, list[dict]] = {}
    for row in rows:
        by_topic.setdefault(row["topic"], []).append(row)
        assert row["type"] in {"technical", "behavioural"}
        assert row["difficulty"] in {"easy", "medium", "hard"}
        assert 3 <= len(row["expected_concepts"]) <= 6

    for tech_topic in ("dsa", "dbms", "os", "cn", "oop", "web", "aiml"):
        assert len(by_topic[tech_topic]) >= 8
        assert all(r["type"] == "technical" for r in by_topic[tech_topic])

    assert len(by_topic["hr"]) >= 25
    assert all(r["type"] == "behavioural" for r in by_topic["hr"])


def test_embed_dimension_and_idempotent_qdrant_retrieval() -> None:
    vec = embed("explain normalization in DBMS")
    assert len(vec) == EMBEDDING_DIM

    client = QdrantClient(":memory:")
    first_count = ingest_kb(client=client)
    second_count = ingest_kb(client=client)
    assert first_count == second_count >= 81

    # Idempotent upsert must not duplicate points in Qdrant
    total_points = client.count(collection_name=KB_COLLECTION_NAME, exact=True).count
    assert total_points == first_count

    # Top-3 semantic retrieval for DBMS normalization
    hits = retrieve("explain normalization in DBMS", k=3, client=client)
    assert len(hits) == 3
    assert hits[0]["topic"] == "dbms"
    assert "normalization" in hits[0]["question"].lower()
    assert hits[0]["score"] > 0.5
    assert len(hits[0]["expected_concepts"]) >= 3

    # Payload filters restrict results strictly
    hr_hits = retrieve(
        "resolving a disagreement with a teammate",
        type="behavioural",
        difficulty="medium",
        topic="hr",
        k=3,
        client=client,
    )
    assert len(hr_hits) > 0
    assert all(
        h["type"] == "behavioural" and h["difficulty"] == "medium" and h["topic"] == "hr"
        for h in hr_hits
    )

    # Best reference lookup
    ref = get_reference_for_question("explain normalization in DBMS", topic="dbms", client=client)
    assert ref is not None
    assert "1NF" in ref["reference_answer"]
    assert len(ref["expected_concepts"]) >= 3


def test_sample_bank_question_respects_exclusions() -> None:
    all_hr_easy = [
        r["question"]
        for r in load_kb_rows(DEFAULT_KB_DIR)
        if r["type"] == "behavioural" and r["difficulty"] == "easy"
    ]
    excluded = all_hr_easy[:-1]
    picked = sample_bank_question(
        type="behavioural",
        difficulty="easy",
        exclude_questions=excluded,
    )
    assert picked["type"] == "behavioural"
    assert picked["difficulty"] == "easy"
    assert picked["question"] == all_hr_easy[-1]
    assert len(picked["expected_concepts"]) >= 3
