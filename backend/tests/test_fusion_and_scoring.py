"""Unit and integration tests for scoring math, band edges, fusion strategies, and session results."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

import app.config as config_module
import app.features as features_module
import app.fusion as fusion_module
import app.llm as llm_module
import app.main as main_module
import app.rag as rag_module
import app.scoring as scoring_module
from app.db import Base, get_db
from app.models import Question


@pytest.fixture()
def client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    db_file = tmp_path / "test_fusion_scoring.db"
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
            test_client._session_factory = TestingSessionLocal  # type: ignore[attr-defined]
            yield test_client
    finally:
        main_module.app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def _auth_headers(client: TestClient, email: str = "fusion@example.edu") -> dict[str, str]:
    client.post(
        "/auth/register",
        json={"name": "Fusion User", "email": email, "password": "StrongPassword123"},
    )
    login = client.post(
        "/auth/login",
        json={"email": email, "password": "StrongPassword123"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed_question(
    client: TestClient,
    session_id: int,
    order_no: int,
    topic: str,
    concepts: list[str],
) -> int:
    db: Session = client._session_factory()  # type: ignore[attr-defined]
    try:
        q = Question(
            session_id=session_id,
            order_no=order_no,
            text=f"Explain key principles of {topic} (Q{order_no}).",
            topic=topic,
            type="technical",
            difficulty="medium",
            expected_concepts=concepts,
        )
        db.add(q)
        db.commit()
        db.refresh(q)
        return q.id
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Scoring math & band edge tests
# ---------------------------------------------------------------------------


def test_scoring_weights_answer_score_and_session_score() -> None:
    for rubric, w_map in scoring_module.WEIGHTS.items():
        assert sum(w_map.values()) == pytest.approx(1.0)

    tech_scores = {
        "technical_correctness": 8,
        "relevance": 7,
        "clarity": 6,
        "completeness": 8,
        "communication": 9,
    }
    # 8*.35 + 7*.20 + 6*.15 + 8*.20 + 9*.10 = 7.6
    assert scoring_module.answer_score(tech_scores, "technical") == 7.6

    beh_scores = {
        "star_structure": 9,
        "relevance": 8,
        "clarity": 7,
        "completeness": 6,
        "communication": 8,
    }
    # 9*.30 + 8*.20 + 7*.15 + 6*.25 + 8*.10 = 7.65
    assert scoring_module.answer_score(beh_scores, "behavioural") == 7.65

    # Session score averages and rounds to 1 decimal
    assert scoring_module.session_score([7.6, 8.2, 6.5]) == 7.4
    assert scoring_module.session_score([8.0, 9.0, 8.5]) == 8.5
    assert scoring_module.session_score([]) == 0.0


@pytest.mark.parametrize(
    ("score", "expected_band"),
    [
        (0.0, "Needs Improvement"),
        (3.99, "Needs Improvement"),
        (4.0, "Satisfactory"),
        (5.99, "Satisfactory"),
        (6.0, "Good"),
        (7.99, "Good"),
        (8.0, "Excellent"),
        (10.0, "Excellent"),
    ],
)
def test_band_thresholds_exact_edges(score: float, expected_band: str) -> None:
    assert scoring_module.band(score) == expected_band


# ---------------------------------------------------------------------------
# Feature-level & decision-level fusion tests
# ---------------------------------------------------------------------------


def test_feature_level_fusion_accepts_result_dict_and_weights() -> None:
    llm_result = {
        "scores": {
            "technical_correctness": 8,
            "relevance": 7,
            "clarity": 6,
            "completeness": 8,
            "communication": 9,
        },
        "concepts_covered": ["1NF", "3NF"],
    }
    assert fusion_module.feature_level(llm_result, scoring_module.WEIGHTS["technical"]) == 7.6
    assert fusion_module.feature_level(llm_result, scoring_module.WEIGHTS) == 7.6


def test_decision_level_fusion_with_and_without_delivery() -> None:
    # content_score = (0.5 * 0.8 + 0.5 * 0.6) * 10 = 7.0
    # With delivery = 9.0 and default w = {llm: .6, content: .3, delivery: .1}:
    # 0.6 * 8.0 + 0.3 * 7.0 + 0.1 * 9.0 = 4.8 + 2.1 + 0.9 = 7.8
    with_delivery = fusion_module.decision_level(
        llm_score=8.0,
        sim_reference=0.8,
        concept_coverage=0.6,
        delivery_score_or_None=9.0,
        w={"llm": 0.6, "content": 0.3, "delivery": 0.1},
    )
    assert with_delivery == 7.8

    # Passing delivery_features dict directly computes mean(normalized) * 10 = 9.0
    delivery_dict = {
        "normalized": {
            "speaking_rate_wpm": 1.0,
            "pause_frequency": 0.8,
            "filler_count": 0.9,
            "duration_sec": 0.9,
        }
    }
    assert fusion_module.compute_delivery_score(delivery_dict) == 9.0
    with_delivery_dict = fusion_module.decision_level(
        llm_score=8.0,
        sim_reference=0.8,
        concept_coverage=0.6,
        delivery_score_or_None=delivery_dict,
    )
    assert with_delivery_dict == 7.8

    # Without delivery (typed answer): remaining weights renormalized: llm = 0.6/0.9 = 2/3, content = 0.3/0.9 = 1/3
    # (2/3) * 8.0 + (1/3) * 7.0 = 23 / 3 = 7.6667
    without_delivery = fusion_module.decision_level(
        llm_score=8.0,
        sim_reference=0.8,
        concept_coverage=0.6,
        delivery_score_or_None=None,
    )
    assert without_delivery == pytest.approx(23.0 / 3.0, abs=1e-4)


# ---------------------------------------------------------------------------
# End-to-end /complete and /result tests (plus dual method_scores storage)
# ---------------------------------------------------------------------------


def test_complete_and_result_endpoints_and_dual_fusion_storage(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _auth_headers(client)

    # Switch FUSION_METHOD to decision_level to verify settings-driven selection
    monkeypatch.setattr(config_module.settings, "FUSION_METHOD", "decision_level")

    session_id = client.post(
        "/sessions",
        headers=headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Fresher",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 3,
        },
    ).json()["id"]

    q1_id = _seed_question(client, session_id, 1, "dbms", ["1NF", "2NF", "3NF", "redundancy"])
    q2_id = _seed_question(client, session_id, 2, "os", ["deadlock", "mutex", "starvation"])
    q3_id = _seed_question(client, session_id, 3, "cn", ["SYN", "SYN-ACK", "ACK"])

    # Attempting to complete before answers are submitted returns 400
    early_complete = client.post(f"/sessions/{session_id}/complete", headers=headers)
    assert early_complete.status_code == 400

    # Attempting to fetch result before completion returns 400
    early_result = client.get(f"/sessions/{session_id}/result", headers=headers)
    assert early_result.status_code == 400

    monkeypatch.setattr(rag_module, "get_reference_for_question", lambda q, topic=None: None)
    monkeypatch.setattr(
        features_module,
        "content_features",
        lambda **kwargs: {
            "sim_question": 0.7,
            "sim_reference": 0.8,
            "concept_coverage": 0.6,
            "concepts_covered": ["1NF", "3NF"],
            "word_count": 70,
            "length_score": 1.0,
            "star_structure": None,
        },
    )

    llm_payloads: list[dict[str, Any]] = [
        {
            "scores": {
                "technical_correctness": 8,
                "relevance": 8,
                "clarity": 8,
                "completeness": 8,
                "communication": 8,
            },
            "concepts_covered": ["1NF", "3NF"],
        },
        {
            "scores": {
                "technical_correctness": 6,
                "relevance": 6,
                "clarity": 6,
                "completeness": 6,
                "communication": 6,
            },
            "concepts_covered": ["deadlock", "mutex"],
        },
        {
            "scores": {
                "technical_correctness": 10,
                "relevance": 10,
                "clarity": 10,
                "completeness": 10,
                "communication": 10,
            },
            "concepts_covered": ["SYN", "SYN-ACK", "ACK"],
        },
    ]
    call_idx = {"i": 0}

    def fake_llm(system: str, user: str, temperature: float = 0.0) -> dict[str, Any]:
        payload = llm_payloads[call_idx["i"]]
        call_idx["i"] += 1
        return payload

    monkeypatch.setattr(llm_module, "call_llm_json", fake_llm)

    for qid in (q1_id, q2_id, q3_id):
        ans_resp = client.post(
            f"/sessions/{session_id}/questions/{qid}/answer",
            headers=headers,
            data={"input_mode": "text", "text": "Detailed technical answer text."},
        )
        assert ans_resp.status_code == 201, ans_resp.text
        ev = ans_resp.json()["evaluation"]
        assert ev["fusion_method"] == "decision_level"
        assert set(ev["method_scores"].keys()) == {"feature_level", "decision_level"}
        assert ev["fused_score"] == ev["method_scores"]["decision_level"]

    # Now all 3 questions are answered & evaluated -> /complete succeeds
    done = client.post(f"/sessions/{session_id}/complete", headers=headers)
    assert done.status_code == 200, done.text
    done_body = done.json()
    assert done_body["status"] == "completed"
    assert done_body["completed_at"] is not None
    # Typed answers (content=7.0, weights llm=2/3, content=1/3):
    # Q1: (2/3)*8 + (1/3)*7 = 7.6667
    # Q2: (2/3)*6 + (1/3)*7 = 6.3333
    # Q3: (2/3)*10 + (1/3)*7 = 9.0
    # Mean = 23.0 / 3 = 7.6667 -> rounded 1 decimal = 7.7 -> band = "Good"
    assert done_body["overall_score"] == 7.7
    assert done_body["band"] == "Good"

    # Fetch /result and verify per-question breakdown and plain missing concepts list
    res = client.get(f"/sessions/{session_id}/result", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["session_score"] == 7.7
    assert body["band"] == "Good"
    assert body["fusion_method"] == "decision_level"
    assert len(body["questions"]) == 3

    q1_res, q2_res, q3_res = body["questions"]
    assert q1_res["topic"] == "dbms"
    assert q1_res["input_mode"] == "text"
    assert q1_res["concepts_covered"] == ["1NF", "3NF"]
    assert q1_res["concepts_missing"] == ["2NF", "redundancy"]
    assert q2_res["concepts_missing"] == ["starvation"]
    assert q3_res["concepts_missing"] == []
