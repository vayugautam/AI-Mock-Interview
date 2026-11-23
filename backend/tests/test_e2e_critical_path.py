"""End-to-end critical-path test covering the full candidate interview lifecycle.

Exercises:
  register -> login -> /auth/me -> create session -> next-question (x3) ->
  answer (text + voice with mocked STT + 502 retry-evaluation) -> complete -> result
"""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

import app.features as features_module
import app.llm as llm_module
import app.main as main_module
import app.rag as rag_module
import app.routers.sessions as sessions_router_module
import app.speech as speech_module
from app.db import Base, get_db


@pytest.fixture()
def client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    db_file = tmp_path / "test_e2e.db"
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
    monkeypatch.setattr(sessions_router_module, "UPLOADS_DIR", tmp_path / "uploads")
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


def test_full_interview_critical_path_with_mocked_llm_and_stt(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 0. Health check
    assert client.get("/health").json() == {"status": "ok"}

    # Mock RAG retrieval, embeddings, and content features for fast hermetic execution
    monkeypatch.setattr(rag_module, "retrieve", lambda *args, **kwargs: [])
    monkeypatch.setattr(
        rag_module,
        "get_reference_for_question",
        lambda q_text, topic=None: {
            "reference_answer": "Structured technical reference answer.",
            "expected_concepts": ["concept_a", "concept_b", "concept_c"],
        },
    )
    embed_lookup = {
        "normalization": [1.0, 0.0, 0.0],
        "deadlock": [0.0, 1.0, 0.0],
        "handshake": [0.0, 0.0, 1.0],
    }
    monkeypatch.setattr(
        rag_module,
        "embed",
        lambda text: next(
            (vec for kw, vec in embed_lookup.items() if kw in text.lower()),
            [0.5, 0.5, 0.0],
        ),
    )
    monkeypatch.setattr(
        features_module,
        "content_features",
        lambda **kwargs: {
            "sim_question": 0.78,
            "sim_reference": 0.85,
            "concept_coverage": 0.67,
            "concepts_covered": ["concept_a", "concept_b"],
            "word_count": 72,
            "length_score": 1.0,
            "star_structure": None,
        },
    )

    # Mock STT pipeline for the voice answer on Question 2
    fake_wav = tmp_path / "voice_processed.wav"
    fake_wav.write_bytes(b"RIFF....WAVE")
    monkeypatch.setattr(speech_module, "preprocess_audio", lambda p: str(fake_wav))
    monkeypatch.setattr(speech_module, "get_audio_duration_sec", lambda p: 36.0)
    monkeypatch.setattr(
        speech_module,
        "transcribe",
        lambda p: {
            "text": "Um, deadlock requires mutual exclusion, hold and wait, no preemption, and circular wait.",
            "words": [
                {"word": "Um,", "start": 0.0, "end": 0.2},
                {"word": "deadlock", "start": 0.3, "end": 0.8},
                {"word": "requires", "start": 0.9, "end": 1.3},
                {"word": "mutual", "start": 1.4, "end": 1.8},
                {"word": "exclusion,", "start": 1.9, "end": 2.4},
                {"word": "circular", "start": 2.5, "end": 3.0},
                {"word": "wait.", "start": 3.1, "end": 3.5},
            ],
        },
    )

    # Mock centralized LLM JSON calls for both question generation and evaluation
    qgen_queue = iter(
        [
            {
                "question": "Explain database normalization and the goals of 1NF, 2NF, and 3NF.",
                "topic": "dbms",
                "type": "technical",
                "difficulty": "medium",
                "expected_concepts": ["1NF", "2NF", "3NF", "redundancy"],
            },
            {
                "question": "What are the four Coffman conditions for OS deadlock?",
                "topic": "os",
                "type": "technical",
                "difficulty": "medium",
                "expected_concepts": ["mutual exclusion", "hold and wait", "no preemption", "circular wait"],
            },
            {
                "question": "Walk through the TCP three-way handshake.",
                "topic": "cn",
                "type": "technical",
                "difficulty": "medium",
                "expected_concepts": ["SYN", "SYN-ACK", "ACK"],
            },
        ]
    )
    eval_queue = iter(
        [
            # Q1 evaluation succeeds
            {
                "scores": {
                    "technical_correctness": 8,
                    "relevance": 8,
                    "clarity": 8,
                    "completeness": 8,
                    "communication": 8,
                },
                "concepts_covered": ["1NF", "2NF", "3NF"],
            },
            # Q2 voice evaluation succeeds
            {
                "scores": {
                    "technical_correctness": 9,
                    "relevance": 9,
                    "clarity": 8,
                    "completeness": 8,
                    "communication": 8,
                },
                "concepts_covered": ["mutual exclusion", "hold and wait", "no preemption", "circular wait"],
            },
            # Q3 initial evaluation fails (3 invalid attempts -> 502)
            {"scores": {"bad": 1}, "concepts_covered": []},
            {"scores": {"bad": 1}, "concepts_covered": []},
            {"scores": {"bad": 1}, "concepts_covered": []},
            # Q3 retry-evaluation succeeds
            {
                "scores": {
                    "technical_correctness": 7,
                    "relevance": 8,
                    "clarity": 7,
                    "completeness": 7,
                    "communication": 8,
                },
                "concepts_covered": ["SYN", "SYN-ACK"],
            },
        ]
    )

    def fake_llm(system: str, user: str, temperature: float = 0.0) -> dict[str, Any]:
        if "Generate exactly ONE interview question" in system:
            return next(qgen_queue)
        return next(eval_queue)

    monkeypatch.setattr(llm_module, "call_llm_json", fake_llm)

    # 1. Register -> Login -> /auth/me
    reg = client.post(
        "/auth/register",
        json={"name": "E2E Candidate", "email": "e2e@example.edu", "password": "StrongPassword123"},
    )
    assert reg.status_code == 201, reg.text

    login = client.post(
        "/auth/login",
        json={"email": "e2e@example.edu", "password": "StrongPassword123"},
    )
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    me = client.get("/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["email"] == "e2e@example.edu"

    # 2. Create session & confirm it appears in list + detail
    session_resp = client.post(
        "/sessions",
        headers=headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Fresher",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 3,
        },
    )
    assert session_resp.status_code == 201, session_resp.text
    session_id = session_resp.json()["id"]
    assert len(client.get("/sessions", headers=headers).json()) == 1
    assert client.get(f"/sessions/{session_id}", headers=headers).json()["status"] == "in_progress"

    # 3. Q1: generate + submit typed answer
    q1 = client.post(f"/sessions/{session_id}/next-question", headers=headers)
    assert q1.status_code == 201, q1.text
    q1_id = q1.json()["id"]

    a1 = client.post(
        f"/sessions/{session_id}/questions/{q1_id}/answer",
        headers=headers,
        data={
            "input_mode": "text",
            "text": "Normalization uses 1NF, 2NF, and 3NF to organize relational tables cleanly.",
            "time_taken_sec": "45",
        },
    )
    assert a1.status_code == 201, a1.text
    assert a1.json()["evaluation"]["eval_version"] == "eval-v1"
    assert a1.json()["evaluation"]["delivery_score"] is None
    assert set(a1.json()["evaluation"]["method_scores"]) == {"feature_level", "decision_level"}

    # 4. Q2: generate + submit voice answer (mocked Whisper STT)
    q2 = client.post(f"/sessions/{session_id}/next-question", headers=headers)
    assert q2.status_code == 201, q2.text
    q2_id = q2.json()["id"]

    a2 = client.post(
        f"/sessions/{session_id}/questions/{q2_id}/answer",
        headers=headers,
        data={"input_mode": "voice", "time_taken_sec": "36"},
        files={"audio": ("answer.webm", b"fake-webm-audio", "audio/webm")},
    )
    assert a2.status_code == 201, a2.text
    assert a2.json()["input_mode"] == "voice"
    assert a2.json()["delivery_features"] is not None
    assert a2.json()["evaluation"]["delivery_score"] is not None

    # 5. Q3: generate + submit typed answer (502 failure -> retry-evaluation succeeds)
    q3 = client.post(f"/sessions/{session_id}/next-question", headers=headers)
    assert q3.status_code == 201, q3.text
    q3_id = q3.json()["id"]

    a3_fail = client.post(
        f"/sessions/{session_id}/questions/{q3_id}/answer",
        headers=headers,
        data={"input_mode": "text", "text": "Client sends SYN, server sends SYN-ACK.", "time_taken_sec": "20"},
    )
    assert a3_fail.status_code == 502

    a3_retry = client.post(
        f"/sessions/{session_id}/questions/{q3_id}/retry-evaluation",
        headers=headers,
    )
    assert a3_retry.status_code == 200, a3_retry.text
    assert a3_retry.json()["evaluation"]["eval_version"] == "eval-v1"

    # 6. Complete session
    done = client.post(f"/sessions/{session_id}/complete", headers=headers)
    assert done.status_code == 200, done.text
    done_body = done.json()
    assert done_body["status"] == "completed"
    # Feature-level scores: Q1 = 8.0, Q2 = 8.55, Q3 = 7.3 -> mean = 7.95 -> rounded 1 decimal = 8.0 -> Excellent
    assert done_body["overall_score"] == 8.0
    assert done_body["band"] == "Excellent"

    # 7. Fetch full result
    res = client.get(f"/sessions/{session_id}/result", headers=headers)
    assert res.status_code == 200, res.text
    res_body = res.json()
    assert res_body["session_score"] == 8.0
    assert res_body["band"] == "Excellent"
    assert len(res_body["questions"]) == 3
    assert res_body["questions"][0]["concepts_missing"] == ["redundancy"]
    assert res_body["questions"][1]["input_mode"] == "voice"
    assert res_body["questions"][1]["concepts_missing"] == []
    assert res_body["questions"][2]["concepts_missing"] == ["ACK"]
