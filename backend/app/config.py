"""Application configuration loaded from environment variables / .env."""

from __future__ import annotations

import secrets
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Centralized settings backed by environment variables and `.env`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database: PostgreSQL in production, SQLite supported for quick local testing
    DATABASE_URL: str = "sqlite:///./mock_interview.db"

    # Auth / JWT: set a strong random string in `.env` for persistent sessions
    JWT_SECRET: str = Field(default_factory=lambda: secrets.token_urlsafe(32))
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 12

    # LLM provider config (consumed exclusively by app/llm.py)
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "llama-3.3-70b-versatile"
    LLM_BASE_URL: str = "https://api.groq.com/openai/v1"

    # Vector DB, Speech-to-Text, and Score Fusion config
    QDRANT_URL: str = "http://localhost:6333"
    WHISPER_MODEL: str = "base"
    FUSION_METHOD: str = "feature_level"

    @field_validator("JWT_SECRET", mode="before")
    @classmethod
    def _ensure_non_empty_jwt_secret(cls, value: object) -> str:
        if isinstance(value, str) and value.strip():
            return value.strip()
        return secrets.token_urlsafe(32)

    @field_validator("FUSION_METHOD", mode="before")
    @classmethod
    def _validate_fusion_method(cls, value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            return "feature_level"
        norm = value.strip().lower()
        if norm not in ("feature_level", "decision_level"):
            raise ValueError(
                f"Invalid FUSION_METHOD '{value}'. Expected 'feature_level' or 'decision_level'."
            )
        return norm


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()


settings = get_settings()
