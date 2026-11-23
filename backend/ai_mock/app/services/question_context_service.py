from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import InterviewSession
from app.schemas.company_research import CompanyResearchRequest
from app.services.company_research_cache_service import (
    cache_is_fresh,
    get_cached_research,
    profile_from_cache,
    save_research_cache,
)
from app.services.company_research_service import CompanyResearchError, research_company
from app.services.resume_retrieval_service import build_index_from_text, retrieve_resume_chunks
from app.services.retrieval_service import RetrievedContext, retrieve_reference_material


@dataclass(frozen=True)
class QuestionContext:
    resume_chunks: tuple[dict[str, Any], ...] = ()
    company_profile: dict[str, Any] | None = None
    technical_references: tuple[RetrievedContext, ...] = ()


def assemble_question_context(
    db: Session,
    *,
    interview_session: InterviewSession,
    settings: Settings | None = None,
) -> QuestionContext:
    current_settings = settings or get_settings()
    resume_chunks: list[dict[str, Any]] = []
    if interview_session.resume is not None and interview_session.resume.extracted_text.strip():
        index = build_index_from_text(
            interview_session.resume.extracted_text,
            resume_id=interview_session.resume.id,
        )
        ranked = retrieve_resume_chunks(
            index,
            role=interview_session.role,
            interview_type=interview_session.interview_type,
            difficulty=interview_session.difficulty,
            question_text=interview_session.role,
            limit=5,
        )
        resume_chunks = [
            {
                "text": item.text,
                "section": item.section_label,
                "resume_id": item.source.resume_id,
                "start_char": item.source.char_start,
                "end_char": item.source.char_end,
                "relevance_score": item.relevance_score,
                "retrieval_method": "tfidf_keyword",
            }
            for item in ranked
        ]

    company_profile: dict[str, Any] | None = None
    if interview_session.company_name:
        request = CompanyResearchRequest(
            company_name=interview_session.company_name,
            target_role=interview_session.role,
            country_region=interview_session.country_region,
            job_description_url=interview_session.job_description_url,
            job_description_text=interview_session.job_description_text,
        )
        cached = get_cached_research(db, request=request)
        if cached is not None:
            status = "cached" if cache_is_fresh(cached) else "stale"
            company_profile = profile_from_cache(cached, status=status).model_dump(mode="json")
        else:
            try:
                profile = research_company(request, settings=current_settings)
                save_research_cache(
                    db,
                    request=request,
                    profile=profile,
                    settings=current_settings,
                )
                company_profile = profile.model_copy(update={"cache_status": "live"}).model_dump(mode="json")
            except (CompanyResearchError, RuntimeError, TimeoutError):
                company_profile = None

    references = retrieve_reference_material(
        f"{interview_session.role} {interview_session.interview_type}",
        limit=3,
    )
    return QuestionContext(
        resume_chunks=tuple(resume_chunks),
        company_profile=company_profile,
        technical_references=tuple(references),
    )
