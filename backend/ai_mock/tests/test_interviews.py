from app.api.routes import interviews as interview_routes
from sqlalchemy.exc import SQLAlchemyError


def registration_payload(email: str) -> dict[str, str]:
    return {"email": email, "password": "Correct Horse Battery Staple"}


def auth_headers(client, email: str) -> dict[str, str]:
    payload = registration_payload(email)
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def interview_payload(**overrides: str) -> dict[str, str]:
    payload = {
        "role": "Backend Engineer",
        "difficulty": "intermediate",
        "interview_type": "technical",
    }
    payload.update(overrides)
    return payload


def test_interview_endpoints_require_authentication(client):
    assert client.post("/api/v1/interviews", json=interview_payload()).status_code == 401
    assert client.get("/api/v1/interviews").status_code == 401
    assert client.get("/api/v1/interviews/1").status_code == 401


def test_create_interview_session(client):
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/interviews",
        json={**interview_payload(role="  Senior   Backend Engineer  "), "user_id": 999},
        headers=headers,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["role"] == "Senior Backend Engineer"
    assert body["difficulty"] == "intermediate"
    assert body["interview_type"] == "technical"
    assert body["status"] == "created"
    assert isinstance(body["id"], int)
    assert body["user_id"] == 1
    assert "created_at" in body


def test_create_interview_rejects_invalid_fields(client):
    headers = auth_headers(client, "candidate@example.com")

    response = client.post(
        "/api/v1/interviews",
        json=interview_payload(role=" ", difficulty="expert", interview_type="screening"),
        headers=headers,
    )

    assert response.status_code == 422


def test_list_interviews_returns_only_current_users_sessions_newest_first(client):
    candidate_headers = auth_headers(client, "candidate@example.com")
    other_headers = auth_headers(client, "other@example.com")
    first = client.post(
        "/api/v1/interviews", json=interview_payload(role="Python Developer"), headers=candidate_headers
    ).json()
    second = client.post(
        "/api/v1/interviews", json=interview_payload(role="Platform Engineer"), headers=candidate_headers
    ).json()
    client.post("/api/v1/interviews", json=interview_payload(role="Other Role"), headers=other_headers)

    response = client.get("/api/v1/interviews", headers=candidate_headers)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [second["id"], first["id"]]
    assert client.get("/api/v1/interviews", headers=other_headers).json()[0]["id"] != first["id"]


def test_list_interviews_returns_empty_list_when_user_has_no_sessions(client):
    response = client.get(
        "/api/v1/interviews", headers=auth_headers(client, "candidate@example.com")
    )

    assert response.status_code == 200
    assert response.json() == []


def test_get_interview_returns_owned_session(client):
    headers = auth_headers(client, "candidate@example.com")
    created = client.post("/api/v1/interviews", json=interview_payload(), headers=headers).json()

    response = client.get(f"/api/v1/interviews/{created['id']}", headers=headers)

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_get_interview_hides_other_users_session(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    created = client.post("/api/v1/interviews", json=interview_payload(), headers=owner_headers).json()

    response = client.get(f"/api/v1/interviews/{created['id']}", headers=other_headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Interview session not found"


def test_get_interview_returns_not_found_for_missing_session(client):
    headers = auth_headers(client, "candidate@example.com")

    response = client.get("/api/v1/interviews/999", headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Interview session not found"


def test_create_interview_rolls_back_when_database_operation_fails(client, monkeypatch):
    headers = auth_headers(client, "candidate@example.com")

    def fail_after_add(db, **kwargs):
        from app.models import InterviewSession

        db.add(
            InterviewSession(
                user_id=kwargs["user_id"],
                role="Failed",
                difficulty="beginner",
                interview_type="technical",
                status="created",
            )
        )
        raise SQLAlchemyError("simulated database failure")

    monkeypatch.setattr(interview_routes, "create_interview_session", fail_after_add)

    response = client.post("/api/v1/interviews", json=interview_payload(), headers=headers)

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to create interview session"
    assert client.get("/api/v1/interviews", headers=headers).json() == []
