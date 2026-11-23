"""Pytest suite for app/speech.py helpers and POST /sessions/{id}/questions/{qid}/answer."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

import app.evaluator as evaluator_module
import app.main as main_module
import app.routers.sessions as sessions_router_module
import app.speech as speech_module
from app.db import Base, get_db
from app.models import Question


@pytest.fixture()
def client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    db_file = tmp_path / "test_speech_answers.db"
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
            test_client._session_factory = TestingSessionLocal  # type: ignore[attr-defined]
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


def _seed_question(client: TestClient, session_id: int, order_no: int = 1) -> int:
    db: Session = client._session_factory()  # type: ignore[attr-defined]
    try:
        q = Question(
            session_id=session_id,
            order_no=order_no,
            text="Explain database normalization and 3NF.",
            topic="dbms",
            type="technical",
            difficulty="medium",
            expected_concepts=["1NF", "2NF", "3NF", "redundancy"],
        )
        db.add(q)
        db.commit()
        db.refresh(q)
        return q.id
    finally:
        db.close()


def test_clean_transcript_removes_fillers_but_keeps_semantic_like() -> None:
    raw = (
        "Um, basically, you know, I like Python and tools like Docker, "
        "uh, basically we use B+ trees, like, to speed up queries, hmm, basically."
    )
    cleaned = speech_module.clean_transcript(raw)
    assert "um" not in cleaned.lower().split()
    assert "uh" not in cleaned.lower().split()
    assert "hmm" not in cleaned.lower().split()
    assert "you know" not in cleaned.lower()
    # Legitimate semantic uses of "like" are preserved
    assert "I like Python" in cleaned
    assert "tools like Docker" in cleaned
    # Repeated "basically" collapsed/removed
    assert cleaned.lower().count("basically") <= 1


def test_delivery_features_and_normalized_ranges() -> None:
    # 60 words over 30 seconds => 120 WPM (ideal 90-180 -> normalized 1.0)
    # Include 1 pause > 0.6s (2.0 pauses/min -> normalized 1.0) and 2 fillers ("um", "uh")
    tokens = ["um", "we", "use", "indexing", "uh", "for", "fast", "lookups"] + ["word"] * 52
    words = []
    t = 0.0
    for idx, tok in enumerate(tokens):
        if idx == 4:
            t += 0.9  # pause > 0.6 s
        words.append({"word": tok, "start": round(t, 2), "end": round(t + 0.3, 2)})
        t += 0.45

    feats = speech_module.delivery_features(words, duration_sec=30.0)
    assert feats["speaking_rate_wpm"] == 120.0
    assert feats["pause_frequency"] == 2.0
    assert feats["filler_count"] == 2
    assert feats["duration_sec"] == 30.0
    assert feats["normalized"]["speaking_rate_wpm"] == 1.0
    assert feats["normalized"]["pause_frequency"] == 1.0
    assert feats["normalized"]["duration_sec"] == 1.0
    assert 0.0 <= feats["normalized"]["filler_count"] <= 1.0


def test_submit_text_and_voice_answers_validation_and_stub_hook(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alice_headers = _auth_headers(client, "alice@example.edu", "Alice")
    bob_headers = _auth_headers(client, "bob@example.edu", "Bob")

    session_id = client.post(
        "/sessions",
        headers=alice_headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Fresher",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 4,
        },
    ).json()["id"]

    q1_id = _seed_question(client, session_id, order_no=1)
    q2_id = _seed_question(client, session_id, order_no=2)

    eval_calls: list[int] = []

    def spy_evaluate(resp):
        eval_calls.append(resp.id)
        return None

    monkeypatch.setattr(evaluator_module, "evaluate_response", spy_evaluate)

    # Ownership check: Bob cannot answer Alice's question
    bob_resp = client.post(
        f"/sessions/{session_id}/questions/{q1_id}/answer",
        headers=bob_headers,
        data={"input_mode": "text", "text": "Normalized tables reduce redundancy."},
    )
    assert bob_resp.status_code == 403

    # Text answer succeeds with delivery_features=None
    text_resp = client.post(
        f"/sessions/{session_id}/questions/{q1_id}/answer",
        headers=alice_headers,
        data={
            "input_mode": "text",
            "text": "Um, normalization removes redundancy across 1NF, 2NF, and 3NF.",
            "time_taken_sec": "42.5",
        },
    )
    assert text_resp.status_code == 201, text_resp.text
    body = text_resp.json()
    assert body["input_mode"] == "text"
    assert body["delivery_features"] is None
    assert body["audio_path"] is None
    assert body["duration_sec"] == 42.5
    assert "Um" in body["raw_text"]
    assert "um" not in body["cleaned_text"].lower().split()
    assert len(eval_calls) == 1

    # Duplicate answer on same question returns 409 Conflict
    dup_resp = client.post(
        f"/sessions/{session_id}/questions/{q1_id}/answer",
        headers=alice_headers,
        data={"input_mode": "text", "text": "Second attempt"},
    )
    assert dup_resp.status_code == 409

    # Voice answer: mock preprocess_audio, get_audio_duration_sec, and transcribe
    fake_wav = tmp_path / "processed.wav"
    fake_wav.write_bytes(b"RIFF....WAVE")

    monkeypatch.setattr(speech_module, "preprocess_audio", lambda p: str(fake_wav))
    monkeypatch.setattr(speech_module, "get_audio_duration_sec", lambda p: 30.0)
    monkeypatch.setattr(
        speech_module,
        "transcribe",
        lambda p: {
            "text": "Uh, normalization removes transitive dependencies in 3NF.",
            "words": [
                {"word": "Uh,", "start": 0.0, "end": 0.2},
                {"word": "normalization", "start": 0.3, "end": 0.8},
                {"word": "removes", "start": 1.6, "end": 2.0},
                {"word": "transitive", "start": 2.1, "end": 2.6},
                {"word": "dependencies", "start": 2.7, "end": 3.2},
                {"word": "in", "start": 3.3, "end": 3.4},
                {"word": "3NF.", "start": 3.5, "end": 3.9},
            ],
        },
    )

    voice_resp = client.post(
        f"/sessions/{session_id}/questions/{q2_id}/answer",
        headers=alice_headers,
        data={"input_mode": "voice", "time_taken_sec": "31.0"},
        files={"audio": ("answer.webm", b"fake-webm-bytes", "audio/webm")},
    )
    assert voice_resp.status_code == 201, voice_resp.text
    vbody = voice_resp.json()
    assert vbody["input_mode"] == "voice"
    assert vbody["audio_path"].startswith("uploads/")
    assert vbody["delivery_features"]["filler_count"] == 1
    assert vbody["delivery_features"]["pause_frequency"] == 2.0
    assert "normalized" in vbody["delivery_features"]
    assert len(eval_calls) == 2
