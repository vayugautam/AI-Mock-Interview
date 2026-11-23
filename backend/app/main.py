"""FastAPI entry point with CORS, startup table creation, and routers."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import Base, engine
from app.routers import auth as auth_router
from app.routers import sessions as sessions_router

# Ensure all ORM models are registered on Base.metadata before create_all
from app import models as _models  # noqa: F401


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Create database tables on application startup (Alembic not required)."""
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="AI Mock Interview Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth_router.router)
app.include_router(sessions_router.router)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    """Liveness check endpoint."""
    return {"status": "ok"}
