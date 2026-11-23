from app.models import InterviewSession


def auth_headers(client, email: str) -> dict[str, str]:
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_interview(client, headers: dict[str, str]) -> dict:
    response = client.post(
        "/api/v1/interviews",
        json={"role": "Backend Engineer", "difficulty": "intermediate", "interview_type": "technical"},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def complete_url(session_id: int) -> str:
    return f"/api/v1/interviews/{session_id}/complete"


def test_complete_interview_and_retrieve_status(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)

    completed = client.post(complete_url(interview["id"]), headers=headers)
    status_response = client.get(f"/api/v1/interviews/{interview['id']}/status", headers=headers)

    assert completed.status_code == 200
    assert completed.json() == {"id": interview["id"], "status": "completed", "already_completed": False}
    assert status_response.status_code == 200
    assert status_response.json() == {"id": interview["id"], "status": "completed"}


def test_completion_is_idempotent(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)
    assert client.post(complete_url(interview["id"]), headers=headers).status_code == 200

    response = client.post(complete_url(interview["id"]), headers=headers)

    assert response.status_code == 200
    assert response.json() == {"id": interview["id"], "status": "completed", "already_completed": True}


def test_lifecycle_endpoints_require_authentication(client):
    assert client.post(complete_url(1)).status_code == 401
    assert client.get("/api/v1/interviews/1/status").status_code == 401


def test_completion_hides_other_users_session(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    interview = create_interview(client, owner_headers)

    for response in (
        client.post(complete_url(interview["id"]), headers=other_headers),
        client.get(f"/api/v1/interviews/{interview['id']}/status", headers=other_headers),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == "Interview session not found"


def test_completion_rejects_invalid_status_transition(client, db_session):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)
    db_session.get(InterviewSession, interview["id"]).status = "invalid"
    db_session.commit()

    response = client.post(complete_url(interview["id"]), headers=headers)

    assert response.status_code == 409
    assert response.json()["detail"] == "Interview session cannot be completed from its current status"


def test_completion_prevents_question_generation_and_answer_saves(client):
    headers = auth_headers(client, "candidate@example.com")
    interview = create_interview(client, headers)
    questions_response = client.post(
        f"/api/v1/interviews/{interview['id']}/questions",
        json={"number_of_questions": 1},
        headers=headers,
    )
    question = questions_response.json()["questions"][0]
    assert questions_response.status_code == 201
    assert client.post(
        f"/api/v1/interviews/{interview['id']}/questions/{question['id']}/answer",
        json={"answer_text": "Original answer"},
        headers=headers,
    ).status_code == 201
    assert client.post(complete_url(interview["id"]), headers=headers).status_code == 200

    question_generation = client.post(
        f"/api/v1/interviews/{interview['id']}/questions",
        json={"number_of_questions": 1},
        headers=headers,
    )
    answer_save = client.post(
        f"/api/v1/interviews/{interview['id']}/questions/{question['id']}/answer",
        json={"answer_text": "Updated answer"},
        headers=headers,
    )

    assert question_generation.status_code == 409
    assert answer_save.status_code == 409
