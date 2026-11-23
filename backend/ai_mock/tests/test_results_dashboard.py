from decimal import Decimal


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


def submit_answer(client, headers: dict[str, str], session_id: int, question_id: int, text: str) -> dict:
    response = client.post(
        f"/api/v1/interviews/{session_id}/questions/{question_id}/answer",
        json={"answer_text": text},
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def evaluate(client, headers: dict[str, str], session_id: int, question_id: int) -> dict:
    response = client.post(
        f"/api/v1/interviews/{session_id}/questions/{question_id}/evaluate",
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def test_result_and_dashboard_endpoints_require_authentication(client):
    assert client.get("/api/v1/interviews/1/results").status_code == 401
    assert client.get("/api/v1/dashboard/summary").status_code == 401
    assert client.get("/api/v1/dashboard/progress").status_code == 401


def test_results_preserve_question_order_and_unevaluated_answers(client):
    headers = auth_headers(client, "candidate@example.com")
    interview, questions = create_interview_with_questions(client, headers)
    first_answer = submit_answer(client, headers, interview["id"], questions[0]["id"], "First detailed answer")
    submit_answer(client, headers, interview["id"], questions[1]["id"], "Second detailed answer")
    evaluation = evaluate(client, headers, interview["id"], questions[0]["id"])

    response = client.get(f"/api/v1/interviews/{interview['id']}/results", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == interview["id"]
    assert body["role"] == "Backend Engineer"
    assert [item["id"] for item in body["questions"]] == [questions[0]["id"], questions[1]["id"]]
    assert body["questions"][0]["answer_id"] == first_answer["id"]
    assert body["questions"][0]["evaluation"]["id"] == evaluation["id"]
    assert body["questions"][1]["answer_text"] == "Second detailed answer"
    assert body["questions"][1]["evaluation"] is None


def test_results_return_empty_answer_details_and_hide_other_users_sessions(client):
    owner_headers = auth_headers(client, "owner@example.com")
    other_headers = auth_headers(client, "other@example.com")
    interview, questions = create_interview_with_questions(client, owner_headers, count=1)

    empty_results = client.get(f"/api/v1/interviews/{interview['id']}/results", headers=owner_headers)
    inaccessible = client.get(f"/api/v1/interviews/{interview['id']}/results", headers=other_headers)
    missing = client.get("/api/v1/interviews/999/results", headers=owner_headers)

    assert empty_results.status_code == 200
    assert empty_results.json()["questions"][0]["id"] == questions[0]["id"]
    assert empty_results.json()["questions"][0]["answer_id"] is None
    assert empty_results.json()["questions"][0]["evaluation"] is None
    assert inaccessible.status_code == 404
    assert missing.status_code == 404


def test_dashboard_returns_empty_state(client):
    headers = auth_headers(client, "candidate@example.com")

    summary = client.get("/api/v1/dashboard/summary", headers=headers)
    progress = client.get("/api/v1/dashboard/progress", headers=headers)

    assert summary.status_code == 200
    assert summary.json() == {
        "total_interviews": 0,
        "completed_interviews": 0,
        "in_progress_interviews": 0,
        "total_answered_questions": 0,
        "average_overall_score": None,
        "recent_interviews": [],
    }
    assert progress.status_code == 200
    assert progress.json() == {"progress": []}


def test_dashboard_uses_only_current_users_records_and_calculates_average(client):
    headers = auth_headers(client, "candidate@example.com")
    other_headers = auth_headers(client, "other@example.com")
    completed, completed_questions = create_interview_with_questions(client, headers, count=2)
    first_answer = submit_answer(client, headers, completed["id"], completed_questions[0]["id"], "First answer with requirements and testing")
    second_answer = submit_answer(client, headers, completed["id"], completed_questions[1]["id"], "Second answer with trade-offs and validation")
    first_evaluation = evaluate(client, headers, completed["id"], completed_questions[0]["id"])
    second_evaluation = evaluate(client, headers, completed["id"], completed_questions[1]["id"])
    assert client.post(f"/api/v1/interviews/{completed['id']}/complete", headers=headers).status_code == 200

    in_progress, in_progress_questions = create_interview_with_questions(client, headers, count=1)
    submit_answer(client, headers, in_progress["id"], in_progress_questions[0]["id"], "Unevaluated answer")

    other_interview, other_questions = create_interview_with_questions(client, other_headers, count=1)
    submit_answer(client, other_headers, other_interview["id"], other_questions[0]["id"], "Other user answer")
    evaluate(client, other_headers, other_interview["id"], other_questions[0]["id"])

    summary = client.get("/api/v1/dashboard/summary", headers=headers)
    progress = client.get("/api/v1/dashboard/progress", headers=headers)

    assert summary.status_code == 200
    body = summary.json()
    assert body["total_interviews"] == 2
    assert body["completed_interviews"] == 1
    assert body["in_progress_interviews"] == 1
    assert body["total_answered_questions"] == 3
    expected_average = (
        Decimal(str(first_evaluation["overall_score"])) + Decimal(str(second_evaluation["overall_score"]))
    ) / Decimal("2")
    assert Decimal(str(body["average_overall_score"])) == expected_average.quantize(Decimal("0.01"))
    assert [item["id"] for item in body["recent_interviews"]] == [in_progress["id"], completed["id"]]

    assert progress.status_code == 200
    history = progress.json()["progress"]
    assert [item["answer_id"] for item in history] == [first_answer["id"], second_answer["id"]]
    assert all(item["session_id"] == completed["id"] for item in history)
    assert all("evaluated_at" in item for item in history)
