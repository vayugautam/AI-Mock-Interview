"""
CORS tests — verify that CORSMiddleware is correctly configured for the four
permitted development origins and that disallowed origins are rejected.

Covered:
- OPTIONS preflight for every allowed origin on /auth/register
- OPTIONS preflight from the port-5174 loopback origin on /auth/login
- Actual POST /auth/login from http://127.0.0.1:5174 (the failing origin)
- Actual POST /auth/register from every allowed origin
- Rejection of an origin that is not in the allow-list
"""

import pytest

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]

_REGISTER_URL = "/api/v1/auth/register"
_LOGIN_URL = "/api/v1/auth/login"

_PREFLIGHT_HEADERS = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "Authorization, Content-Type",
}


def _register_and_login(client, email: str, password: str = "Correct Horse Battery Staple") -> str:
    """Register a user and return a valid access token."""
    client.post(_REGISTER_URL, json={"email": email, "password": password})
    resp = client.post(_LOGIN_URL, json={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed: {resp.json()}"
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Preflight (OPTIONS) tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_preflight_register_allows_permitted_origin(client, origin):
    """Every allowed origin must pass the preflight check on /auth/register."""
    response = client.options(
        _REGISTER_URL,
        headers={"Origin": origin, **_PREFLIGHT_HEADERS},
    )

    assert response.status_code == 200, f"Preflight failed for {origin}"
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "Authorization" in response.headers["access-control-allow-headers"]
    assert "Content-Type" in response.headers["access-control-allow-headers"]


def test_preflight_login_allows_loopback_5174(client):
    """Regression: OPTIONS /auth/login from 127.0.0.1:5174 must succeed."""
    origin = "http://127.0.0.1:5174"
    response = client.options(
        _LOGIN_URL,
        headers={"Origin": origin, **_PREFLIGHT_HEADERS},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_preflight_login_allows_localhost_5174(client):
    """OPTIONS /auth/login from localhost:5174 must also succeed."""
    origin = "http://localhost:5174"
    response = client.options(
        _LOGIN_URL,
        headers={"Origin": origin, **_PREFLIGHT_HEADERS},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


# ---------------------------------------------------------------------------
# Actual POST /auth/login from port-5174 origins (the failing scenario)
# ---------------------------------------------------------------------------


def test_login_response_includes_cors_header_for_loopback_5174(client):
    """
    Regression test: POST /auth/login from http://127.0.0.1:5174 must
    return Access-Control-Allow-Origin so the browser can read the response.
    """
    origin = "http://127.0.0.1:5174"
    email = "cors5174loopback@example.com"
    password = "Correct Horse Battery Staple"

    client.post(_REGISTER_URL, json={"email": email, "password": password})

    response = client.post(
        _LOGIN_URL,
        headers={"Origin": origin, "Content-Type": "application/json"},
        json={"email": email, "password": password},
    )

    assert response.status_code == 200, f"Login failed: {response.json()}"
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.headers.get("access-control-allow-credentials") == "true"
    assert response.json()["token_type"] == "bearer"
    assert response.json()["access_token"]


def test_login_response_includes_cors_header_for_localhost_5174(client):
    """POST /auth/login from http://localhost:5174 must also carry CORS headers."""
    origin = "http://localhost:5174"
    email = "cors5174local@example.com"
    password = "Correct Horse Battery Staple"

    client.post(_REGISTER_URL, json={"email": email, "password": password})

    response = client.post(
        _LOGIN_URL,
        headers={"Origin": origin, "Content-Type": "application/json"},
        json={"email": email, "password": password},
    )

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.json()["access_token"]


# ---------------------------------------------------------------------------
# Actual POST /auth/register — CORS header present for every allowed origin
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_register_response_includes_cors_header(client, origin, request):
    """Successful registration from every allowed origin must carry CORS headers."""
    # Use a unique email per parametrize run
    safe = origin.replace("http://", "").replace(":", "_").replace(".", "_")
    email = f"cors_{safe}@example.com"

    response = client.post(
        _REGISTER_URL,
        headers={"Origin": origin, "Content-Type": "application/json"},
        json={"email": email, "password": "Correct Horse Battery Staple"},
    )

    assert response.status_code == 201, f"Registration failed for {origin}: {response.json()}"
    assert response.headers.get("access-control-allow-origin") == origin
    assert response.headers.get("access-control-allow-credentials") == "true"


# ---------------------------------------------------------------------------
# Disallowed origin must not receive CORS headers
# ---------------------------------------------------------------------------


def test_disallowed_origin_does_not_receive_cors_headers(client):
    """Requests from origins outside the allow-list must not get CORS headers."""
    origin = "http://evil.example.com"

    response = client.options(
        _REGISTER_URL,
        headers={"Origin": origin, **_PREFLIGHT_HEADERS},
    )

    assert response.headers.get("access-control-allow-origin") != origin
