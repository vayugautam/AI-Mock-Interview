"""Authentication and current-user FastAPI dependencies."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Union

from fastapi import Depends, Header, HTTPException, Request, status


@dataclass
class AuthenticatedUser:
    """Verified user principal attached to authenticated document requests."""

    id: str
    name: str
    email: str
    target_field: str = "Full Stack Development"
    skills: list[str] = field(default_factory=list)
    active_jd_id: Optional[str] = None
    active_resume_id: Optional[str] = None


def hash_password_pbkdf2(password: str, salt: str) -> str:
    """Match PBKDF2-SHA512 hashing used by the Node/Express auth store."""
    return hashlib.pbkdf2_hmac(
        "sha512",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        10000,
        dklen=64,
    ).hex()


UnionPathLike = Union[os.PathLike[str], str]


class TokenSessionStore:
    """File-backed user lookup and Bearer session token registry."""

    def __init__(self, data_dir: UnionPathLike = "data") -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.users_file = self.data_dir / "users.json"
        self.sessions: dict[str, str] = {}

    def _load_users(self) -> dict[str, dict[str, Any]]:
        if not self.users_file.is_file():
            return {}
        try:
            raw = json.loads(self.users_file.read_text(encoding="utf-8"))
            return raw if isinstance(raw, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_users(self, users: dict[str, dict[str, Any]]) -> None:
        self.users_file.write_text(json.dumps(users, indent=2), encoding="utf-8")

    def issue_token_for_user(
        self,
        *,
        user_id: str,
        name: str,
        email: str,
        password: str = "demo1234",
        target_field: str = "Full Stack Development",
    ) -> str:
        """Create or update a user record and return a fresh Bearer session token."""
        users = self._load_users()
        existing = users.get(user_id)
        if not existing:
            salt = secrets.token_hex(16)
            users[user_id] = {
                "id": user_id,
                "name": name.strip(),
                "email": email.strip().lower(),
                "passwordHash": hash_password_pbkdf2(password, salt),
                "salt": salt,
                "targetField": target_field,
                "skills": [],
            }
            self._save_users(users)

        token = "tok_" + secrets.token_hex(32)
        self.sessions[token] = user_id
        return token

    def verify_password(self, email: str, password: str) -> Optional[AuthenticatedUser]:
        normalized = email.strip().lower()
        users = self._load_users()
        for record in users.values():
            if str(record.get("email", "")).lower() == normalized:
                salt = str(record.get("salt", ""))
                expected_hash = str(record.get("passwordHash", ""))
                computed = hash_password_pbkdf2(password, salt)
                if salt and expected_hash and hmac.compare_digest(computed, expected_hash):
                    return self._to_principal(record)
        return None

    def get_user_by_token(self, token: str) -> Optional[AuthenticatedUser]:
        user_id = self.sessions.get(token)
        if not user_id:
            return None
        users = self._load_users()
        record = users.get(user_id)
        if not record:
            return None
        return self._to_principal(record)

    def update_active_document(
        self,
        user_id: str,
        *,
        doc_type: str,
        doc_id: Optional[str],
        skills: Optional[list[str]] = None,
        target_field: Optional[str] = None,
    ) -> None:
        users = self._load_users()
        record = users.get(user_id)
        if not record:
            return
        if doc_type == "jd":
            record["activeJdId"] = doc_id
            if target_field and target_field != "Unknown":
                record["targetField"] = target_field
        elif doc_type == "resume":
            record["activeResumeId"] = doc_id
            if skills is not None:
                record["skills"] = skills[:10]
        users[user_id] = record
        self._save_users(users)

    @staticmethod
    def _to_principal(record: dict[str, Any]) -> AuthenticatedUser:
        return AuthenticatedUser(
            id=str(record["id"]),
            name=str(record.get("name", "")),
            email=str(record.get("email", "")),
            target_field=str(record.get("targetField", "Full Stack Development")),
            skills=list(record.get("skills") or []),
            active_jd_id=record.get("activeJdId"),
            active_resume_id=record.get("activeResumeId"),
        )


_default_session_store: Optional[TokenSessionStore] = None


def get_session_store(request: Optional[Request] = None) -> TokenSessionStore:
    """Resolve the active TokenSessionStore from FastAPI app state or default data dir."""
    if request is not None:
        app_state = getattr(getattr(request, "app", None), "state", None)
        store = getattr(app_state, "session_store", None)
        if isinstance(store, TokenSessionStore):
            return store

    global _default_session_store
    if _default_session_store is None:
        _default_session_store = TokenSessionStore(os.environ.get("DATA_DIR", "data"))
    return _default_session_store


async def get_current_user(
    authorization: Optional[str] = Header(default=None),
    session_store: TokenSessionStore = Depends(get_session_store),
) -> AuthenticatedUser:
    """Validate Bearer token and resolve the authenticated user principal."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Missing or invalid Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Empty authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = session_store.get_user_by_token(token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Session expired or invalid",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user
