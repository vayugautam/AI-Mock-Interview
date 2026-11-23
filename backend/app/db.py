"""SQLAlchemy 2.x database engine, session factory, and FastAPI dependency."""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


def _build_engine(database_url: str):
    """Create a SQLAlchemy engine configured for PostgreSQL or SQLite."""
    is_sqlite = database_url.startswith("sqlite")
    connect_args: dict[str, Any] = {"check_same_thread": False} if is_sqlite else {}
    engine_kwargs: dict[str, Any] = {
        "connect_args": connect_args,
        "future": True,
    }
    if not is_sqlite:
        engine_kwargs["pool_pre_ping"] = True

    eng = create_engine(database_url, **engine_kwargs)

    # Enforce foreign key constraints when running against SQLite
    if is_sqlite:
        @event.listens_for(eng, "connect")
        def _enable_sqlite_fks(dbapi_conn, _connection_record) -> None:
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return eng


engine = _build_engine(settings.DATABASE_URL)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=Session,
)


class Base(DeclarativeBase):
    """Base declarative class for all ORM models."""


def get_db() -> Generator[Session, None, None]:
    """Yield a request-scoped database session and close it cleanly."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
