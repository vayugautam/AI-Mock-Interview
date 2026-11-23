from decimal import Decimal

from app.api.routes import evaluations as evaluation_routes
from app.models import Evaluation
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError


def auth_headers(client, email: str) -> dict[str, str]:
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_answer(client, headers: dict[str, str]) -> tuple[dict, dict, dict]:
    interview = client.post(
        "/api/v1/interviews",
        json={"role": "Backend Engineer", "difficulty": "intermediate", "interview_type": "technical"},
        headers=headers,
    ).json()
    question = client.post(
        f"/api/v1/interviews/{interview['id']}/questions",
        json={"number_of_questions": 1},
        headers=headers,
    ).json()["questions"][0]
    answer = client.post(
        f"/api/v1/interviews/{interview['id']}/questions/{question['id']}/answer",
        json={"answer_text": "I would clarify requirements, assess trade-offs, test the solution, and communicate the result."},
        headers=headers,
    ).json()
    return interview, question, answer


def evaluation_url(session_id: int, question_id: int) -> str:
    return f"/api/v1/interviews/{session_id}/questions/{question_id}/evaluate"


def test_question_evaluation_persists_valid_mock_result(client, db_session):
    headers = auth_headers(client, "candidate@example.com")
    interview, question, answer = create_answer(client, headers)

    response = client.post(evaluation_url(interview["id"], question["id"]), headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert body["answer_id"] == answer["id"]
    assert body["metadata"]["provider"] == "deterministic_mock"
    assert body["metadata"]["is_ai_generated"] is False
    assert "Mock evaluation only" in body["feedback"]
    scores = [Decimal(str(body[field])) for field in ("correctness_score", "relevance_score", "clarity_score", "completeness_score")]
    assert all(Decimal("0") <= score <= Decimal("100") for score in scores)
    assert db_session.get(Evaluation, body["id"]).answer_id == answer["id"]


def test_question_evaluation_requires_authentication(client):
    assert client.post(evaluation_url(1, 1)).status_code == 401


def test_question_evaluation_rejects_missing_answer_and_mismatched_question(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, question, _ = create_answer(client, headers)
    other_interview, other_question, _ = create_answer(client, headers)
    unanswered_interview = client.post(
        "/api/v1/interviews",
        json={"role": "Backend Engineer", "difficulty": "intermediate", "interview_type": "technical"},
        headers=headers,
    ).json()
    unanswered_question = client.post(
        f"/api/v1/interviews/{unanswered_interview['id']}/questions",
        json={"number_of_questions": 1},
        headers=headers,
    ).json()["questions"][0]

    mismatched = client.post(evaluation_url(interview["id"], other_question["id"]), headers=headers)
    missing_answer = client.post(
        evaluation_url(unanswered_interview["id"], unanswered_question["id"]),
        headers=headers,
    )

    assert other_interview["id"] != interview["id"]
    assert mismatched.status_code == 404
    assert missing_answer.status_code == 404
    assert missing_answer.json()["detail"] == "Answer not found for this interview question"


def test_question_evaluation_hides_other_users_session(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    interview, question, _ = create_answer(client, owner_headers)

    response = client.post(evaluation_url(interview["id"], question["id"]), headers=other_headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Interview session not found"


def test_question_evaluation_rejects_duplicates_and_completed_sessions(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, question, _ = create_answer(client, headers)
    assert client.post(evaluation_url(interview["id"], question["id"]), headers=headers).status_code == 201
    assert client.post(evaluation_url(interview["id"], question["id"]), headers=headers).status_code == 409

    second_interview, second_question, _ = create_answer(client, headers)
    assert client.post(f"/api/v1/interviews/{second_interview['id']}/complete", headers=headers).status_code == 200
    completed = client.post(evaluation_url(second_interview["id"], second_question["id"]), headers=headers)

    assert completed.status_code == 409
    assert completed.json()["detail"] == "Cannot evaluate answers for a completed interview session"


def test_question_evaluation_handles_invalid_provider_and_database_failure(client, monkeypatch, db_session):
    headers = auth_headers(client, "candidate@example.com")
    interview, question, answer = create_answer(client, headers)
    original_provider = evaluation_routes.evaluation_provider

    class InvalidProvider:
        provider_name = "invalid"
        is_ai_generated = False

        def evaluate(self, **kwargs):
            return {"correctness_score": 101, "feedback": "Incomplete"}

    monkeypatch.setattr(evaluation_routes, "evaluation_provider", InvalidProvider())
    invalid = client.post(evaluation_url(interview["id"], question["id"]), headers=headers)
    assert invalid.status_code == 502

    def fail_after_add(db, **kwargs):
        db.add(Evaluation(answer_id=kwargs["answer"].id, correctness_score=1, relevance_score=1, clarity_score=1, completeness_score=1, overall_score=1, feedback="Failed"))
        raise SQLAlchemyError("simulated database failure")

    monkeypatch.setattr(evaluation_routes, "evaluation_provider", original_provider)
    monkeypatch.setattr(evaluation_routes, "create_evaluation", fail_after_add)
    failed = client.post(evaluation_url(interview["id"], question["id"]), headers=headers)

    assert failed.status_code == 500
    assert failed.json()["detail"] == "Unable to store answer evaluation"
    assert db_session.scalar(
        select(func.count()).select_from(Evaluation).where(Evaluation.answer_id == answer["id"])
    ) == 0
