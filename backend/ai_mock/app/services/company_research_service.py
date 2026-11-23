from __future__ import annotations

from datetime import UTC, datetime
from app.core.config import Settings, get_settings
from app.schemas.company_research import (
    CompanyResearchProfile,
    CompanyResearchRequest,
    ResearchSource,
)
from app.services.company_evidence_service import extract_evidence, infer_priorities
from app.services.company_page_service import (
    PageDocument,
    PageFetchError,
    UnsafeUrlError,
    fetch_public_page,
    sanitize_public_url,
)
from app.services.company_search_provider import (
    SearchResult,
    SearchProvider,
    SearchProviderError,
    get_search_provider,
)


class CompanyResearchError(Exception):
    """Raised when company research cannot be completed safely."""


def research_company(
    request: CompanyResearchRequest,
    *,
    search_provider: SearchProvider | None = None,
    settings: Settings | None = None,
) -> CompanyResearchProfile:
    current_settings = settings or get_settings()
    provider = search_provider or get_search_provider(current_settings)
    pages: list[PageDocument] = []
    sources: list[ResearchSource] = []
    limitations: list[str] = []
    search_calls = 0
    fetched_urls: set[str] = set()
    supplied_url = str(request.job_description_url) if request.job_description_url else None

    if supplied_url:
        try:
            safe_url = sanitize_public_url(supplied_url)
            page = _fetch_page(safe_url, current_settings)
            pages.append(page)
            fetched_urls.add(page.url)
            sources.append(_source_for_page(page, "official_job_description"))
        except (UnsafeUrlError, PageFetchError) as exc:
            limitations.append("The supplied job-description URL could not be safely retrieved.")

    queries = [
        f'"{request.company_name}" "{request.target_role}" job description {request.country_region or ""}',
        f'"{request.company_name}" careers interview process "{request.target_role}"',
        f'"{request.company_name}" "{request.target_role}" skills assessment requirements',
    ]
    for query in queries:
        if search_calls >= max(1, current_settings.company_research_max_search_calls):
            limitations.append("Search budget reached before all planned research queries ran.")
            break
        search_calls += 1
        try:
            results = provider.search(query, limit=8)
        except SearchProviderError:
            limitations.append("The public search provider was unavailable.")
            break
        for result in _prioritize_results(results):
            if len(pages) >= max(1, current_settings.company_research_max_pages):
                limitations.append("Page fetch limit reached.")
                break
            try:
                safe_url = sanitize_public_url(result.url)
                if safe_url in fetched_urls:
                    continue
                page = _fetch_page(safe_url, current_settings)
            except (UnsafeUrlError, PageFetchError):
                continue
            pages.append(page)
            fetched_urls.add(page.url)
            sources.append(_source_for_search_result(result, page))

    if request.job_description_text:
        pages.append(
            PageDocument(
                title="User-supplied job description",
                url=supplied_url or "",
                text=request.job_description_text,
                retrieved_at=datetime.now(UTC),
            )
        )
        sources.append(
            ResearchSource(
                title="User-supplied job description",
                url=supplied_url,
                source_type="user_supplied_job_description",
                retrieved_at=pages[-1].retrieved_at,
                evidence_strength="medium",
            )
        )

    findings, skills, requirements, stages, technical_subjects = extract_evidence(
        pages,
        source_for_page=lambda page: _source_for_document(page, sources),
    )
    inferred = infer_priorities(findings)
    if not pages:
        limitations.append("No readable public sources were retrieved.")
    if not skills:
        limitations.append("No reliable company-specific skills were identified.")
    if not stages:
        limitations.append("No official interview stages or assessment criteria were found.")
    if not requirements:
        limitations.append("No role-specific requirements were extracted from available sources.")

    return CompanyResearchProfile(
        company_name=request.company_name,
        target_role=request.target_role,
        country_region=request.country_region,
        key_skills=skills,
        role_requirements=requirements,
        interview_stages_or_expectations=stages,
        technical_subject_areas=technical_subjects,
        inferred_priorities=inferred,
        findings=findings,
        sources=sources,
        missing_information=[
            item for item, missing in (
                ("role requirements", not requirements),
                ("interview stages", not stages),
                ("technical subject areas", not technical_subjects),
            ) if missing
        ],
        limitations=list(dict.fromkeys(limitations)),
        retrieval_method=f"{provider.provider_name}+bounded_public_page_extraction",
        researched_at=datetime.now(UTC),
    )


def _fetch_page(url: str, settings: Settings) -> PageDocument:
    return fetch_public_page(
        url,
        timeout_seconds=settings.company_research_timeout_seconds,
        max_content_bytes=settings.company_research_max_content_bytes,
        user_agent=settings.company_research_user_agent,
    )


def _prioritize_results(results: list[SearchResult]) -> list[SearchResult]:
    return sorted(results, key=lambda result: (_source_type(result.url, result.title) not in {
        "official_job_description", "official_careers", "official_interview_prep", "official_engineering"
    }, result.url))


def _source_type(url: str, title: str) -> str:
    text = f"{url} {title}".lower()
    if any(term in text for term in ("interview", "prep", "hiring process")):
        return "official_interview_prep"
    if any(term in text for term in ("careers", "jobs", "job description", "greenhouse", "lever")):
        return "official_job_description" if "job" in text else "official_careers"
    if any(term in text for term in ("engineering", "developer", "technology")):
        return "official_engineering"
    if any(term in text for term in ("glassdoor", "reddit", "levels.fyi", "blind")):
        return "candidate_report"
    return "other_public_source"


def _source_for_page(page: PageDocument, source_type: str) -> ResearchSource:
    return ResearchSource(
        title=page.title,
        url=page.url or None,
        source_type=source_type,
        retrieved_at=page.retrieved_at,
        evidence_strength="high" if source_type.startswith("official") else "low",
    )


def _source_for_search_result(result: SearchResult, page: PageDocument) -> ResearchSource:
    return _source_for_page(page, _source_type(result.url, result.title))


def _source_for_document(page: PageDocument, sources: list[ResearchSource]) -> ResearchSource:
    for source in sources:
        if source.url and source.url == page.url:
            return source
        if source.title == page.title and not page.url:
            return source
    return ResearchSource(
        title=page.title or "User-supplied job description",
        url=page.url or None,
        source_type="user_supplied_job_description",
        retrieved_at=page.retrieved_at,
        evidence_strength="medium",
    )
