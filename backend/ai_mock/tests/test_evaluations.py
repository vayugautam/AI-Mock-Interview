from decimal import Decimal

from app.api.routes import evaluations as evaluation_routes
from app.models import Evaluation


def auth_headers(client, email: str) -> dict[str, str]:
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_answer(client, headers: dict[str, str]) -> tuple[dict, dict]:
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
    return interview, answer


def evaluation_url(session_id: int, answer_id: int) -> str:
    return f"/api/v1/interviews/{session_id}/answers/{answer_id}/evaluation"


def test_evaluation_endpoint_requires_authentication(client):
    assert client.post(evaluation_url(1, 1)).status_code == 401


def test_evaluate_answer_persists_valid_mock_evaluation(client, db_session):
    headers = auth_headers(client, "candidate@example.com")
    interview, answer = create_answer(client, headers)

    response = client.post(evaluation_url(interview["id"], answer["id"]), headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert body["answer_id"] == answer["id"]
    assert body["metadata"]["provider"] == "deterministic_mock"
    assert body["metadata"]["is_ai_generated"] is False
    assert "0.35 correctness" in body["metadata"]["scoring_method"].lower()
    assert "Mock evaluation only" in body["feedback"]
    criterion_scores = [
        Decimal(str(body[field]))
        for field in ("correctness_score", "relevance_score", "clarity_score", "completeness_score")
    ]
    assert all(Decimal("0") <= score <= Decimal("10") for score in criterion_scores)
    expected_overall = (
        Decimal("0.35") * Decimal(str(body["correctness_score"]))
        + Decimal("0.25") * Decimal(str(body["relevance_score"]))
        + Decimal("0.25") * Decimal(str(body["completeness_score"]))
        + Decimal("0.15") * Decimal(str(body["clarity_score"]))
    ).quantize(Decimal("0.01"))
    assert Decimal(str(body["overall_score"])) == expected_overall
    assert db_session.get(Evaluation, body["id"]).answer_id == answer["id"]


def test_evaluation_hides_other_users_answer(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    interview, answer = create_answer(client, owner_headers)

    response = client.post(evaluation_url(interview["id"], answer["id"]), headers=other_headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Interview session not found"


def test_evaluation_rejects_answer_from_different_session(client):
    headers = auth_headers(client, "candidate@example.com")
    first_interview, _ = create_answer(client, headers)
    second_interview, second_answer = create_answer(client, headers)

    response = client.post(evaluation_url(first_interview["id"], second_answer["id"]), headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Answer not found for this interview session"
    assert first_interview["id"] != second_interview["id"]


def test_evaluation_rejects_duplicate_request(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, answer = create_answer(client, headers)
    assert client.post(evaluation_url(interview["id"], answer["id"]), headers=headers).status_code == 201

    response = client.post(evaluation_url(interview["id"], answer["id"]), headers=headers)

    assert response.status_code == 409
    assert response.json()["detail"] == "An evaluation already exists for this answer"


def test_evaluation_rejects_malformed_provider_scores(client, monkeypatch):
    headers = auth_headers(client, "candidate@example.com")
    interview, answer = create_answer(client, headers)

    class InvalidProvider:
        provider_name = "invalid"
        is_ai_generated = False

        def evaluate(self, **kwargs):
            return {"correctness_score": 101, "feedback": "Incomplete"}

    monkeypatch.setattr(evaluation_routes, "evaluation_provider", InvalidProvider())

    response = client.post(evaluation_url(interview["id"], answer["id"]), headers=headers)

    assert response.status_code == 502
    assert response.json()["detail"] == "Evaluation provider returned an invalid result"


def test_evaluation_returns_safe_error_when_provider_times_out(client, monkeypatch):
    headers = auth_headers(client, "candidate@example.com")
    interview, answer = create_answer(client, headers)

    class TimeoutProvider:
        provider_name = "timeout"
        is_ai_generated = False

        def evaluate(self, **kwargs):
            raise TimeoutError

    monkeypatch.setattr(evaluation_routes, "evaluation_provider", TimeoutProvider())

    response = client.post(evaluation_url(interview["id"], answer["id"]), headers=headers)

    assert response.status_code == 503
    assert response.json()["detail"] == "Evaluation provider is temporarily unavailable"
