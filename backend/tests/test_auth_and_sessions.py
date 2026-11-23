"""Pytest suite for auth and session skeleton endpoints using an isolated SQLite database."""

from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

import app.main as main_module
from app.db import Base, get_db


@pytest.fixture()
def client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[TestClient, None, None]:
    """Create a fresh SQLite database and FastAPI TestClient per test."""
    db_file = tmp_path / "test_mock_interview.db"
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
            yield test_client
    finally:
        main_module.app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=test_engine)
        test_engine.dispose()


def _register_and_login(
    client: TestClient,
    *,
    name: str = "Aarav Sharma",
    email: str = "aarav@example.edu",
    password: str = "StrongPass123",
) -> dict[str, str]:
    reg = client.post(
        "/auth/register",
        json={"name": name, "email": email, "password": password},
    )
    assert reg.status_code == 201, reg.text

    login = client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_health_endpoint(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_register_login_and_me(client: TestClient) -> None:
    reg = client.post(
        "/auth/register",
        json={
            "name": "Priya Nair",
            "email": "Priya.Nair@Example.EDU",
            "password": "Password123!",
        },
    )
    assert reg.status_code == 201
    user_data = reg.json()
    assert user_data["email"] == "priya.nair@example.edu"
    assert "password_hash" not in user_data

    # Duplicate email should fail with 409
    dup = client.post(
        "/auth/register",
        json={
            "name": "Priya Duplicate",
            "email": "priya.nair@example.edu",
            "password": "Password123!",
        },
    )
    assert dup.status_code == 409

    # Wrong password should fail with 401
    bad_login = client.post(
        "/auth/login",
        json={"email": "priya.nair@example.edu", "password": "WrongPassword"},
    )
    assert bad_login.status_code == 401

    # Valid login returns Bearer JWT
    login = client.post(
        "/auth/login",
        json={"email": "priya.nair@example.edu", "password": "Password123!"},
    )
    assert login.status_code == 200
    token_body = login.json()
    assert token_body["token_type"] == "bearer"
    assert token_body["access_token"]

    # /auth/me requires Bearer token
    assert client.get("/auth/me").status_code == 401
    me = client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_body['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["id"] == user_data["id"]
    assert me.json()["email"] == "priya.nair@example.edu"


def test_create_list_and_get_sessions_with_validation_and_isolation(client: TestClient) -> None:
    alice_headers = _register_and_login(
        client, name="Alice", email="alice@example.edu", password="AlicePassword1"
    )
    bob_headers = _register_and_login(
        client, name="Bob", email="bob@example.edu", password="BobPassword1"
    )

    # Reject total_questions outside 3-10
    too_few = client.post(
        "/sessions",
        headers=alice_headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Junior",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 2,
        },
    )
    assert too_few.status_code == 422

    too_many = client.post(
        "/sessions",
        headers=alice_headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Junior",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 11,
        },
    )
    assert too_many.status_code == 422

    # Create valid session for Alice
    created = client.post(
        "/sessions",
        headers=alice_headers,
        json={
            "role": "Backend Engineer",
            "experience_level": "Fresher",
            "interview_type": "technical",
            "difficulty": "medium",
            "total_questions": 5,
        },
    )
    assert created.status_code == 201
    session = created.json()
    assert session["role"] == "Backend Engineer"
    assert session["status"] == "in_progress"
    assert session["total_questions"] == 5
    assert session["overall_score"] is None
    assert session["band"] is None

    # Alice sees her session in GET /sessions and GET /sessions/{id}
    alice_list = client.get("/sessions", headers=alice_headers)
    assert alice_list.status_code == 200
    assert len(alice_list.json()) == 1
    assert alice_list.json()[0]["id"] == session["id"]

    alice_get = client.get(f"/sessions/{session['id']}", headers=alice_headers)
    assert alice_get.status_code == 200
    assert alice_get.json()["id"] == session["id"]

    # Bob cannot see Alice's session in his list or fetch it directly
    bob_list = client.get("/sessions", headers=bob_headers)
    assert bob_list.status_code == 200
    assert bob_list.json() == []

    bob_get = client.get(f"/sessions/{session['id']}", headers=bob_headers)
    assert bob_get.status_code == 403

    # Non-existent session returns 404
    assert client.get("/sessions/99999", headers=alice_headers).status_code == 404
