def registration_payload(
    email: str = "candidate@example.com",
    password: str = "Correct Horse Battery Staple",
) -> dict[str, str]:
    return {"email": email, "password": password}


def test_registration_returns_public_user(client):
    response = client.post("/api/v1/auth/register", json=registration_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "candidate@example.com"
    assert isinstance(body["id"], int)
    assert "password_hash" not in body
    assert "password" not in body


def test_duplicate_registration_returns_conflict(client):
    payload = registration_payload()
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201

    response = client.post("/api/v1/auth/register", json=payload)

    assert response.status_code == 409
    assert response.json()["detail"] == "An account with this email already exists"


def test_invalid_login_returns_unauthorized(client):
    client.post("/api/v1/auth/register", json=registration_payload())

    response = client.post(
        "/api/v1/auth/login",
        json=registration_payload(password="wrong password"),
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_successful_login_returns_bearer_token(client):
    payload = registration_payload()
    client.post("/api/v1/auth/register", json=payload)

    response = client.post("/api/v1/auth/login", json=payload)

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"
    assert response.json()["access_token"]


def test_protected_me_endpoint_returns_current_user(client):
    payload = registration_payload()
    client.post("/api/v1/auth/register", json=payload)
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]

    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == payload["email"]
    assert "password_hash" not in response.json()


def test_invalid_token_cannot_access_me(client):
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer invalid-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid or expired access token"
