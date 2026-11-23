from app.api.routes import answers as answer_routes
from app.models import InterviewSession
from sqlalchemy.exc import SQLAlchemyError


def auth_headers(client, email: str) -> dict[str, str]:
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_interview_with_questions(client, headers: dict[str, str], count: int = 2) -> tuple[dict, list[dict]]:
    interview = client.post(
        "/api/v1/interviews",
        json={"role": "Backend Engineer", "difficulty": "intermediate", "interview_type": "technical"},
        headers=headers,
    ).json()
    questions = client.post(
        f"/api/v1/interviews/{interview['id']}/questions",
        json={"number_of_questions": count},
        headers=headers,
    ).json()["questions"]
    return interview, questions


def answer_url(session_id: int, question_id: int) -> str:
    return f"/api/v1/interviews/{session_id}/questions/{question_id}/answer"


def answers_url(session_id: int) -> str:
    return f"/api/v1/interviews/{session_id}/answers"


def test_answer_endpoints_require_authentication(client):
    assert client.get(answers_url(1)).status_code == 401
    assert client.get(answer_url(1, 1)).status_code == 401
    assert client.post(answer_url(1, 1), json={"answer_text": "My answer"}).status_code == 401


def test_submit_and_retrieve_answer(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)

    response = client.post(
        answer_url(interview["id"], questions[0]["id"]),
        json={"answer_text": "  I would begin by clarifying the problem.  "},
        headers=headers,
    )

    assert response.status_code == 201
    answer = response.json()
    assert answer["session_id"] == interview["id"]
    assert answer["question_id"] == questions[0]["id"]
    assert answer["answer_text"] == "I would begin by clarifying the problem."
    assert isinstance(answer["id"], int)
    assert "created_at" in answer

    listed = client.get(answers_url(interview["id"]), headers=headers)
    assert listed.status_code == 200
    assert listed.json()["answers"] == [answer]

    retrieved = client.get(answer_url(interview["id"], questions[0]["id"]), headers=headers)
    assert retrieved.status_code == 200
    assert retrieved.json() == answer


def test_submit_answer_rejects_blank_and_oversized_text(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)

    for answer_text in ("   ", "a" * 10001):
        response = client.post(
            answer_url(interview["id"], questions[0]["id"]),
            json={"answer_text": answer_text},
            headers=headers,
        )
        assert response.status_code == 422


def test_submit_answer_rejects_missing_or_mismatched_question(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, _ = create_interview_with_questions(client, headers)
    other_interview, other_questions = create_interview_with_questions(client, headers)

    missing = client.post(answer_url(interview["id"], 999), json={"answer_text": "Answer"}, headers=headers)
    mismatched = client.post(
        answer_url(interview["id"], other_questions[0]["id"]),
        json={"answer_text": "Answer"},
        headers=headers,
    )

    assert other_interview["id"] != interview["id"]
    assert missing.status_code == 404
    assert mismatched.status_code == 404
    assert mismatched.json()["detail"] == "Question not found for this interview session"


def test_answer_endpoints_hide_other_users_interview(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    interview, questions = create_interview_with_questions(client, owner_headers)

    for response in (
        client.get(answers_url(interview["id"]), headers=other_headers),
        client.get(answer_url(interview["id"], questions[0]["id"]), headers=other_headers),
        client.post(answer_url(interview["id"], questions[0]["id"]), json={"answer_text": "Answer"}, headers=other_headers),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == "Interview session not found"


def test_answer_resubmission_updates_existing_answer(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)
    url = answer_url(interview["id"], questions[0]["id"])
    first = client.post(url, json={"answer_text": "First answer"}, headers=headers)
    assert first.status_code == 201

    response = client.post(url, json={"answer_text": "Second answer"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["id"] == first.json()["id"]
    assert response.json()["created_at"] == first.json()["created_at"]
    assert response.json()["answer_text"] == "Second answer"
    assert client.get(answers_url(interview["id"]), headers=headers).json()["answers"] == [response.json()]


def test_list_answers_uses_question_sequence_order(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)
    client.post(answer_url(interview["id"], questions[1]["id"]), json={"answer_text": "Second"}, headers=headers)
    client.post(answer_url(interview["id"], questions[0]["id"]), json={"answer_text": "First"}, headers=headers)

    response = client.get(answers_url(interview["id"]), headers=headers)

    assert response.status_code == 200
    assert [answer["question_id"] for answer in response.json()["answers"]] == [
        questions[0]["id"],
        questions[1]["id"],
    ]


def test_get_answer_returns_not_found_when_question_has_no_answer(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)

    response = client.get(answer_url(interview["id"], questions[0]["id"]), headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Answer not found for this interview question"


def test_list_answers_returns_empty_list_when_no_answers_exist(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, _ = create_interview_with_questions(client, headers)

    response = client.get(answers_url(interview["id"]), headers=headers)

    assert response.status_code == 200
    assert response.json() == {"answers": []}


def test_completed_interview_rejects_answer_submission(client, db_session):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)
    db_session.get(InterviewSession, interview["id"]).status = "completed"
    db_session.commit()

    response = client.post(
        answer_url(interview["id"], questions[0]["id"]),
        json={"answer_text": "Answer"},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Cannot submit answers to a completed interview session"


def test_answer_submission_rolls_back_on_database_error(client, monkeypatch):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)

    def fail_after_add(db, **kwargs):
        from app.models import Answer

        db.add(Answer(session_id=kwargs["session_id"], question_id=kwargs["question_id"], answer_text="Failed"))
        raise SQLAlchemyError("simulated database failure")

    monkeypatch.setattr(answer_routes, "submit_answer", fail_after_add)

    response = client.post(
        answer_url(interview["id"], questions[0]["id"]),
        json={"answer_text": "Answer"},
        headers=headers,
    )

    assert response.status_code == 500
    assert response.json()["detail"] == "Unable to submit interview answer"
    assert client.get(answers_url(interview["id"]), headers=headers).json()["answers"] == []
