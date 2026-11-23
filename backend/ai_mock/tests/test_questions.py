from app.api.routes import questions as question_routes
from app.models import InterviewSession
from sqlalchemy.exc import SQLAlchemyError


def auth_headers(client, email: str) -> dict[str, str]:
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_interview(client, headers: dict[str, str], **overrides: str) -> dict:
    payload = {
        "role": "Backend Engineer",
        "difficulty": "intermediate",
        "interview_type": "technical",
    }
    payload.update(overrides)
    response = client.post("/api/v1/interviews", json=payload, headers=headers)
    assert response.status_code == 201
    return response.json()


def questions_url(session_id: int) -> str:
    return f"/api/v1/interviews/{session_id}/questions"


def test_question_endpoints_require_authentication(client):
    assert client.get(questions_url(1)).status_code == 401
    assert client.post(questions_url(1), json={"number_of_questions": 3}).status_code == 401


def test_create_initial_questions_returns_predefined_ordered_questions(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers, role="Python Developer")

    response = client.post(questions_url(interview["id"]), json={"number_of_questions": 3}, headers=headers)

    assert response.status_code == 201
    body = response.json()
    assert body["generation_source"] == "predefined"
    assert len(body["questions"]) == 3
    assert [question["sequence_number"] for question in body["questions"]] == [1, 2, 3]
    assert all(question["session_id"] == interview["id"] for question in body["questions"])
    assert all(isinstance(question["id"], int) for question in body["questions"])
    assert "Python Developer" in body["questions"][0]["question_text"]


def test_get_questions_returns_stable_sequence_order(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)
    created = client.post(questions_url(interview["id"]), json={"number_of_questions": 4}, headers=headers).json()

    response = client.get(questions_url(interview["id"]), headers=headers)

    assert response.status_code == 200
    assert response.json() == created
    assert [question["sequence_number"] for question in response.json()["questions"]] == [1, 2, 3, 4]


def test_question_generation_rejects_invalid_limits(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)

    for number_of_questions in (0, 11):
        response = client.post(
            questions_url(interview["id"]),
            json={"number_of_questions": number_of_questions},
            headers=headers,
        )
        assert response.status_code == 422


def test_question_generation_is_not_repeated(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)
    assert client.post(questions_url(interview["id"]), json={"number_of_questions": 2}, headers=headers).status_code == 201

    repeated = client.post(questions_url(interview["id"]), json={"number_of_questions": 2}, headers=headers)

    assert repeated.status_code == 409
    assert repeated.json()["detail"] == "Questions have already been generated for this interview session"
    assert len(client.get(questions_url(interview["id"]), headers=headers).json()["questions"]) == 2


def test_question_generation_rejects_completed_interview(client, db_session):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)
    db_session.get(InterviewSession, interview["id"]).status = "completed"
    db_session.commit()

    response = client.post(
        questions_url(interview["id"]),
        json={"number_of_questions": 2},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Questions can only be generated while the interview session is created"


def test_question_endpoints_hide_other_users_interview(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    interview = create_interview(client, owner_headers)

    for response in (
        client.get(questions_url(interview["id"]), headers=other_headers),
        client.post(questions_url(interview["id"]), json={"number_of_questions": 2}, headers=other_headers),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == "Interview session not found"


def test_question_generation_rolls_back_on_database_error(client, monkeypatch):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)

    def fail_after_add(db, **kwargs):
        from app.models import Question

        db.add(Question(session_id=kwargs["interview_session"].id, question_text="Failed", sequence_number=1))
        raise SQLAlchemyError("simulated database failure")

    monkeypatch.setattr(question_routes, "create_initial_questions", fail_after_add)

    response = client.post(questions_url(interview["id"]), json={"number_of_questions": 2}, headers=headers)

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to create interview questions"
    assert client.get(questions_url(interview["id"]), headers=headers).json()["questions"] == []
