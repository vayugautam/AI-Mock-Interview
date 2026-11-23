"""FastAPI application factory for the AI Mock Interview Platform backend."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from backend.routes.documents import router as documents_router
from backend.services.auth_dependency import TokenSessionStore
from backend.services.document_service import DocumentRepository


def create_fastapi_app(data_dir: os.PathLike[str] | str | None = None) -> FastAPI:
    """Create and configure the FastAPI application instance."""
    resolved_dir = Path(data_dir or os.environ.get("DATA_DIR", "data"))
    resolved_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI(
        title="AI Mock Interview Platform API",
        version="1.0.0",
        description="JD-driven, resume-aware mock interview upload and preparation API.",
    )
    app.state.session_store = TokenSessionStore(resolved_dir)
    app.state.document_repo = DocumentRepository(resolved_dir)

    app.include_router(documents_router)

    @app.get("/api/health", tags=["Health"])
    async def health_check() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_fastapi_app()
