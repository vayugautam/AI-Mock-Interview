"""FastAPI routes for authenticated Job Description and Resume uploads."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, status
from pydantic import BaseModel, Field

from backend.services.auth_dependency import (
    AuthenticatedUser,
    TokenSessionStore,
    get_current_user,
    get_session_store,
)
from backend.services.document_service import (
    DocumentAccessError,
    DocumentRepository,
    extract_basic_jd_analysis,
    extract_basic_resume_analysis,
    get_document_repository,
    to_public_document_summary,
    validate_pasted_jd_text,
    validate_pdf_upload_and_extract,
)


class JdTextUploadRequest(BaseModel):
    """Request body for submitting pasted Job Description text."""

    text: str = Field(..., min_length=1, description="Pasted Job Description content")
    enableWebResearch: bool = Field(default=True, description="Enable optional web context lookup")


class DocumentSummaryModel(BaseModel):
    """Serialized document metadata and extracted content associated with the owner user."""

    id: str
    userId: str
    docType: Literal["jd", "resume"]
    sourceType: Literal["pdf", "text"]
    fileName: Optional[str] = None
    fileSizeBytes: Optional[int] = None
    pageCount: Optional[int] = None
    charCount: int
    contentSha256: Optional[str] = None
    normalizedText: str
    previewText: str
    analysis: dict[str, Any]
    webResearchSummary: Optional[str] = None
    webSources: list[dict[str, Any]] = Field(default_factory=list)
    webResearchStatus: Literal["completed", "skipped", "unavailable"] = "skipped"
    chunkCount: int
    createdAt: str


class DocumentResponse(BaseModel):
    document: DocumentSummaryModel


class CurrentDocumentsResponse(BaseModel):
    jd: Optional[DocumentSummaryModel] = None
    resume: Optional[DocumentSummaryModel] = None


class DocumentListResponse(BaseModel):
    documents: list[DocumentSummaryModel]
    total: int


class DeleteDocumentResponse(BaseModel):
    deletedId: str
    docType: Literal["jd", "resume"]


router = APIRouter(prefix="/api/documents", tags=["Documents"])


@router.post(
    "/jd/upload-pdf",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and validate a Job Description PDF for the authenticated user",
)
async def upload_jd_pdf(
    file: UploadFile = File(...),
    enableWebResearch: bool = Form(default=True),
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
    session_store: TokenSessionStore = Depends(get_session_store),
) -> dict[str, Any]:
    try:
        validated = await validate_pdf_upload_and_extract(file, doc_type="jd")
    except DocumentAccessError as exc:
        raise exc.to_http_exception() from exc

    analysis = extract_basic_jd_analysis(validated.normalized_text)
    record = doc_repo.create_document(
        user_id=current_user.id,
        doc_type="jd",
        source_type="pdf",
        normalized_text=validated.normalized_text,
        raw_text=validated.raw_text,
        content_sha256=validated.content_sha256,
        analysis=analysis,
        file_name=validated.safe_filename,
        file_size_bytes=validated.file_size_bytes,
        page_count=validated.page_count,
        web_research_status="skipped" if not enableWebResearch else "unavailable",
    )

    session_store.update_active_document(
        current_user.id,
        doc_type="jd",
        doc_id=record["id"],
        target_field=analysis.get("jobTitle"),
    )

    return {"document": to_public_document_summary(record)}


@router.post(
    "/jd/text",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit pasted Job Description text for the authenticated user",
)
async def submit_jd_text(
    payload: JdTextUploadRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
    session_store: TokenSessionStore = Depends(get_session_store),
) -> dict[str, Any]:
    try:
        normalized_text, content_sha256 = validate_pasted_jd_text(payload.text)
    except DocumentAccessError as exc:
        raise exc.to_http_exception() from exc

    analysis = extract_basic_jd_analysis(normalized_text)
    record = doc_repo.create_document(
        user_id=current_user.id,
        doc_type="jd",
        source_type="text",
        normalized_text=normalized_text,
        raw_text=normalized_text,
        content_sha256=content_sha256,
        analysis=analysis,
        web_research_status="skipped" if not payload.enableWebResearch else "unavailable",
    )

    session_store.update_active_document(
        current_user.id,
        doc_type="jd",
        doc_id=record["id"],
        target_field=analysis.get("jobTitle"),
    )

    return {"document": to_public_document_summary(record)}


@router.post(
    "/resume/upload-pdf",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload and validate a candidate Resume PDF for the authenticated user",
)
async def upload_resume_pdf(
    file: UploadFile = File(...),
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
    session_store: TokenSessionStore = Depends(get_session_store),
) -> dict[str, Any]:
    try:
        validated = await validate_pdf_upload_and_extract(file, doc_type="resume")
    except DocumentAccessError as exc:
        raise exc.to_http_exception() from exc

    analysis = extract_basic_resume_analysis(validated.normalized_text)
    record = doc_repo.create_document(
        user_id=current_user.id,
        doc_type="resume",
        source_type="pdf",
        normalized_text=validated.normalized_text,
        raw_text=validated.raw_text,
        content_sha256=validated.content_sha256,
        analysis=analysis,
        file_name=validated.safe_filename,
        file_size_bytes=validated.file_size_bytes,
        page_count=validated.page_count,
    )

    session_store.update_active_document(
        current_user.id,
        doc_type="resume",
        doc_id=record["id"],
        skills=analysis.get("candidateSkills"),
    )

    return {"document": to_public_document_summary(record)}


@router.get(
    "/current",
    response_model=CurrentDocumentsResponse,
    summary="Fetch the authenticated user's active JD and Resume",
)
async def get_current_documents(
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> dict[str, Any]:
    latest_jd = doc_repo.get_latest_for_user(
        current_user.id,
        "jd",
        preferred_id=current_user.active_jd_id,
    )
    latest_resume = doc_repo.get_latest_for_user(
        current_user.id,
        "resume",
        preferred_id=current_user.active_resume_id,
    )

    return {
        "jd": to_public_document_summary(latest_jd) if latest_jd else None,
        "resume": to_public_document_summary(latest_resume) if latest_resume else None,
    }


@router.get(
    "",
    response_model=DocumentListResponse,
    summary="List uploaded JD and Resume documents owned by the authenticated user",
)
async def list_user_documents(
    doc_type: Optional[Literal["jd", "resume"]] = Query(default=None),
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> dict[str, Any]:
    docs = doc_repo.list_for_user(current_user.id, doc_type=doc_type)
    summaries = [to_public_document_summary(doc) for doc in docs]
    return {"documents": summaries, "total": len(summaries)}


@router.get(
    "/{document_id}",
    response_model=DocumentResponse,
    summary="Retrieve a specific uploaded document owned by the authenticated user",
)
async def get_document_by_id(
    document_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
) -> dict[str, Any]:
    try:
        doc = doc_repo.get_document_for_user(document_id, current_user.id)
    except DocumentAccessError as exc:
        raise exc.to_http_exception() from exc
    return {"document": to_public_document_summary(doc)}


@router.delete(
    "/{document_id}",
    response_model=DeleteDocumentResponse,
    summary="Delete an uploaded document owned by the authenticated user",
)
async def delete_document_by_id(
    document_id: str,
    current_user: AuthenticatedUser = Depends(get_current_user),
    doc_repo: DocumentRepository = Depends(get_document_repository),
    session_store: TokenSessionStore = Depends(get_session_store),
) -> dict[str, Any]:
    try:
        deleted = doc_repo.delete_document_for_user(document_id, current_user.id)
    except DocumentAccessError as exc:
        raise exc.to_http_exception() from exc

    doc_type: Literal["jd", "resume"] = deleted["docType"]
    if (
        (doc_type == "jd" and current_user.active_jd_id == document_id)
        or (doc_type == "resume" and current_user.active_resume_id == document_id)
    ):
        next_doc = doc_repo.get_latest_for_user(current_user.id, doc_type)
        session_store.update_active_document(
            current_user.id,
            doc_type=doc_type,
            doc_id=next_doc["id"] if next_doc else None,
        )

    return {"deletedId": document_id, "docType": doc_type}
