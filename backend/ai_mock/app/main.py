import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import models
from app.api.routes import (
    answers,
    auth,
    dashboard,
    database,
    evaluations,
    health,
    interviews,
    questions,
    results,
    resumes,
    company_research,
)
from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(title=settings.app_name, debug=settings.debug)

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5175",
    "http://127.0.0.1:5175",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Ensure CORS headers are present on unhandled 500 errors."""
    origin = request.headers.get("origin", "")
    headers = {}
    if origin in ALLOWED_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    logger.exception("Unhandled server error on %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )


app.include_router(health.router, prefix="/api/v1")
app.include_router(database.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(interviews.router, prefix="/api/v1")
app.include_router(questions.router, prefix="/api/v1")
app.include_router(answers.router, prefix="/api/v1")
app.include_router(evaluations.router, prefix="/api/v1")
app.include_router(results.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(resumes.router, prefix="/api/v1")
app.include_router(company_research.router, prefix="/api/v1")
