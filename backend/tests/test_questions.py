"""Pytest suite for app/llm.py, app/questions.py, and POST /sessions/{id}/next-question."""

from __future__ import annotations

import logging
from collections.abc import Generator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

import app.llm as llm_module
import app.main as main_module
import app.questions as questions_module
import app.rag as rag_module
from app.db import Base, get_db
from app.llm import LLMError, call_llm_json


@pytest.fixture()
def client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    db_file = tmp_path / "test_questions.db"
    test_engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
        future=True,
    )

    @event.listens_for(test_engine, "connect")
    def _enable_fks(dbapi_conn, _connection_record) -> None:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(
        bind=test_engine,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
        class_=Session,
    )
    monkeypatch.setattr(main_module, "engine", test_engine)
    Base.metadata.create_all(bind=test_engine)

    def _override_get_db() -> Generator[Session, None, None]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    main_module.app.dependency_overrides[get_db] = _override_get_db
    try:
        with TestClient(main_module.app) as test_client:
            yield test_client
    finally:
        main_module.app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def _auth_headers(client: TestClient, email: str, name: str = "Candidate") -> dict[str, str]:
    client.post(
        "/auth/register",
        json={"name": name, "email": email, "password": "StrongPassword123"},
    )
    login = client.post(
        "/auth/login",
        json={"email": email, "password": "StrongPassword123"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _dummy_session(
    *,
    interview_type: str = "technical",
    difficulty: str = "medium",
    total_questions: int = 3,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=1,
        role="Backend Engineer",
        experience_level="Fresher",
        interview_type=interview_type,
        difficulty=difficulty,
        total_questions=total_questions,
        skills=["PostgreSQL", "Python"],
    )


def test_call_llm_json_retries_invalid_json_and_strips_fences(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = iter(
        [
            "not valid json at all",
            '```json\n{"question": "Explain B+ tree indexing?", "topic": "dbms"}\n```',
        ]
    )
    monkeypatch.setattr(
        llm_module,
        "_request_provider_completion",
        lambda system, user, temperature: next(responses),
    )

    result = call_llm_json("sys", "usr", temperature=0.0, max_retries=2)
    assert result == {"question": "Explain B+ tree indexing?", "topic": "dbms"}

    # Exhausting retries raises LLMError
    monkeypatch.setattr(
        llm_module,
        "_request_provider_completion",
        lambda system, user, temperature: "still not json",
    )
    with pytest.raises(LLMError):
        call_llm_json("sys", "usr", temperature=0.0, max_retries=2)


def test_generate_question_success_and_prompt_version_log(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        rag_module,
        "retrieve",
        lambda query, type=None, difficulty=None, topic=None, k=4: [
            {
                "text": "Question: Explain normalization.\nReference Answer: 1NF, 2NF, 3NF.",
                "topic": "dbms",
                "difficulty": "medium",
                "expected_concepts": ["1NF", "2NF", "3NF"],
                "score": 0.91,
            }
        ],
    )
    monkeypatch.setattr(
        llm_module,
        "call_llm_json",
        lambda system, user, temperature=0.0, max_retries=2: {
            "question": "How do 2NF and 3NF prevent update anomalies in relational schemas?",
            "topic": "dbms",
            "type": "technical",
            "difficulty": "medium",
            "expected_concepts": [
                "partial dependency",
                "transitive dependency",
                "update anomalies",
                "primary key",
            ],
        },
    )

    with caplog.at_level(logging.INFO, logger=questions_module.__name__):
        out = questions_module.generate_question(_dummy_session(), [])

    assert out["topic"] == "dbms"
    assert out["type"] == "technical"
    assert len(out["expected_concepts"]) == 4
    assert any("qgen-v1" in rec.getMessage() for rec in caplog.records)


def test_generate_question_invalid_json_then_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        rag_module,
        "retrieve",
        lambda query, type=None, difficulty=None, topic=None, k=4: [],
    )
    attempts = {"count": 0}

    def fake_call_llm_json(system: str, user: str, temperature: float = 0.0, max_retries: int = 2):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise LLMError("Malformed JSON on first attempt")
        return {
            "question": "Compare clustered and non-clustered indexes in PostgreSQL.",
            "topic": "dbms",
            "type": "technical",
            "difficulty": "medium",
            "expected_concepts": ["physical ordering", "secondary pointers", "range scans"],
        }

    monkeypatch.setattr(llm_module, "call_llm_json", fake_call_llm_json)

    out = questions_module.generate_question(_dummy_session(), [])
    assert attempts["count"] == 2
    assert "clustered" in out["question"].lower()


def test_generate_question_duplicate_triggers_bank_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        rag_module,
        "retrieve",
        lambda query, type=None, difficulty=None, topic=None, k=4: [],
    )

    # Identical unit vector makes cosine similarity 1.0 (>= 0.85) so every LLM output is rejected
    monkeypatch.setattr(rag_module, "embed", lambda text: [1.0, 0.0, 0.0])

    llm_calls = {"count": 0}

    def fake_dup_llm(system: str, user: str, temperature: float = 0.0, max_retries: int = 2):
        llm_calls["count"] += 1
        return {
            "question": "Can you describe how MVCC works in PostgreSQL?",
            "topic": "dbms",
            "type": "technical",
            "difficulty": "medium",
            "expected_concepts": ["snapshot isolation", "tuple versions", "VACUUM"],
        }

    fallback_called = {"flag": False}

    def fake_sample_bank(type: str, difficulty: str, exclude_questions=None, topic=None):
        fallback_called["flag"] = True
        return {
            "question": "How do B+ Tree indexes accelerate range queries?",
            "reference_answer": "Sorted linked leaves enable O(log n) lookup and sequential scans.",
            "type": type,
            "difficulty": difficulty,
            "topic": topic or "dbms",
            "expected_concepts": ["B+ Tree", "linked leaves", "range scans"],
        }

    monkeypatch.setattr(llm_module, "call_llm_json", fake_dup_llm)
    monkeypatch.setattr(rag_module, "sample_bank_question", fake_sample_bank)

    out = questions_module.generate_question(
        _dummy_session(),
        ["Explain how MVCC avoids read-write blocking in PostgreSQL."],
    )
    assert llm_calls["count"] == 3  # initial attempt + 2 retries
    assert fallback_called["flag"] is True
    assert out["question"] == "How do B+ Tree indexes accelerate range queries?"


def test_next_question_endpoint_persists_checks_ownership_and_enforces_409_limit(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        rag_module,
        "retrieve",
        lambda query, type=None, difficulty=None, topic=None, k=4: [],
    )
    # Distinct orthogonal vectors so the 3 generated questions are never flagged as duplicates
    embed_map = {
        "Q1": [1.0, 0.0, 0.0],
        "Q2": [0.0, 1.0, 0.0],
        "Q3": [0.0, 0.0, 1.0],
    }
    monkeypatch.setattr(
        rag_module,
        "embed",
        lambda text: next((vec for key, vec in embed_map.items() if key in text), [0.5, 0.5, 0.0]),
    )

    generated_seq = iter(
        [
            {
                "question": "Q1: Explain hash table collision resolution techniques.",
                "topic": "dsa",
                "type": "technical",
                "difficulty": "medium",
                "expected_concepts": ["chaining", "open addressing", "load factor"],
            },
            {
                "question": "Q2: Explain SQL transaction isolation levels.",
                "topic": "dbms",
                "type": "technical",
                "difficulty": "medium",
                "expected_concepts": ["dirty read", "phantom read", "Serializable"],
            },
            {
                "question": "Q3: Compare mutexes and counting semaphores.",
                "topic": "os",
                "type": "technical",
                "difficulty": "medium",
                "expected_concepts": ["ownership", "critical section", "signaling"],
            },
        ]
    )
    monkeypatch.setattr(
        llm_module,
        "call_llm_json",
        lambda system, user, temperature=0.0, max_retries=2: next(generated_seq),
    )

    alice_headers = _auth_headers(client, "alice@example.edu", "Alice")
    bob_headers = _auth_headers(client, "bob@example.edu", "Bob")

    session_resp = client.post(
        "/sessions",
        headers=alice_headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Fresher",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 3,
        },
    )
    assert session_resp.status_code == 201
    session_id = session_resp.json()["id"]

    # Bob cannot generate a question on Alice's session
    forbidden = client.post(f"/sessions/{session_id}/next-question", headers=bob_headers)
    assert forbidden.status_code == 403

    # Alice generates all 3 questions in order
    for expected_order in (1, 2, 3):
        q_resp = client.post(f"/sessions/{session_id}/next-question", headers=alice_headers)
        assert q_resp.status_code == 201, q_resp.text
        q_body = q_resp.json()
        assert q_body["session_id"] == session_id
        assert q_body["order_no"] == expected_order
        assert len(q_body["expected_concepts"]) == 3

    # 4th question must return 409 Conflict
    overflow = client.post(f"/sessions/{session_id}/next-question", headers=alice_headers)
    assert overflow.status_code == 409
