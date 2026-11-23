from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.models import InterviewSession, Question
from app.schemas.company_research import CompanyResearchRequest
from app.services.company_research_cache_service import (
    cache_is_fresh,
    get_cached_research,
    profile_from_cache,
)
from app.services.resume_retrieval_service import build_index_from_text, retrieve_resume_chunks
from app.services.retrieval_service import RetrievedContext, retrieve_reference_material


@dataclass(frozen=True)
class EvaluationContext:
    references: tuple[RetrievedContext, ...] = ()
    company_requirements: tuple[str, ...] = ()
    resume_evidence: tuple[dict[str, Any], ...] = ()


def assemble_evaluation_context(
    db: Session,
    *,
    interview_session: InterviewSession,
    question: Question,
) -> EvaluationContext:
    references = retrieve_reference_material(question.question_text, limit=3)

    company_requirements: list[str] = []
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
            profile = profile_from_cache(
                cached,
                status="cached" if cache_is_fresh(cached) else "stale",
            )
            company_requirements.extend(profile.role_requirements)
            company_requirements.extend(profile.key_skills)

    resume_evidence: list[dict[str, Any]] = []
    resume = interview_session.resume
    if resume is not None and resume.extracted_text.strip():
        index = build_index_from_text(resume.extracted_text, resume_id=resume.id)
        for item in retrieve_resume_chunks(
            index,
            role=interview_session.role,
            interview_type=interview_session.interview_type,
            difficulty=interview_session.difficulty,
            question_text=question.question_text,
            limit=3,
        ):
            resume_evidence.append(
                {
                    "section": item.section_label,
                    "text": item.text,
                    "relevance_score": item.relevance_score,
                }
            )

    return EvaluationContext(
        references=tuple(references),
        company_requirements=tuple(dict.fromkeys(company_requirements)),
        resume_evidence=tuple(resume_evidence),
    )
