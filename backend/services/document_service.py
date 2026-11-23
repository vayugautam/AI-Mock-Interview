"""Document validation, integrity verification, and user-scoped storage service."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import HTTPException, Request, status

from backend.services.pdf_extractor import (
    ALLOWED_PDF_MIME_TYPES,
    DEFAULT_MAX_PDF_BYTES,
    DEFAULT_MIN_EXTRACTED_CHARS,
    PdfExtractionError,
    clean_pdf_text,
    extract_uploaded_pdf_text,
)

MAX_PASTED_JD_CHARS = 50_000

COMMON_SKILL_CATALOG = (
    "Python",
    "TypeScript",
    "JavaScript",
    "FastAPI",
    "React",
    "Node.js",
    "PostgreSQL",
    "Redis",
    "Docker",
    "Kubernetes",
    "AWS",
    "Qdrant",
    "SQL",
    "REST API",
    "GraphQL",
    "Git",
    "Linux",
    "Machine Learning",
    "RAG",
)


@dataclass(frozen=True)
class ValidatedPdfPayload:
    """Result of PDF integrity checks and text extraction."""

    safe_filename: str
    content_type: Optional[str]
    file_size_bytes: int
    content_sha256: str
    page_count: int
    raw_text: str
    normalized_text: str
    char_count: int
    word_count: int
    engine: str


class DocumentAccessError(Exception):
    """Raised on validation, not-found, or cross-user ownership violations."""

    def __init__(self, message: str, status_code: int = 400, code: str = "VALIDATION_ERROR") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code

    def to_http_exception(self) -> HTTPException:
        return HTTPException(
            status_code=self.status_code,
            detail={"error": self.message, "code": self.code},
        )


def sanitize_pdf_filename(filename: Optional[str], *, doc_label: str) -> str:
    """Validate and sanitize an uploaded PDF filename to prevent traversal or spoofed extensions."""
    if not filename or not filename.strip():
        raise DocumentAccessError(
            f"Uploaded {doc_label} file is missing a filename.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_FILENAME",
        )

    raw_name = filename.strip()
    if "\x00" in raw_name or ".." in raw_name or "/" in raw_name or "\\" in raw_name:
        raise DocumentAccessError(
            f"Invalid {doc_label} filename. Path separators and control characters are not allowed.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_FILENAME",
        )

    cleaned_name = re.sub(r"[\x00-\x1f\x7f]", "", os.path.basename(raw_name)).strip()
    if not cleaned_name.lower().endswith(".pdf"):
        raise DocumentAccessError(
            f"Invalid {doc_label} file format. Only .pdf files are accepted.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_FILE_TYPE",
        )

    return cleaned_name


async def _read_upload_bytes_bounded(upload_file: Any, max_bytes: int, doc_label: str) -> bytes:
    """Read uploaded bytes safely while bounding memory to `max_bytes + 1`."""
    read_fn = getattr(upload_file, "read", None)
    if callable(read_fn):
        try:
            sig = inspect.signature(read_fn)
            accepts_size = any(
                p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
                for p in sig.parameters.values()
            )
        except (TypeError, ValueError):
            accepts_size = False

        if accepts_size:
            chunks: list[bytes] = []
            total = 0
            chunk_size = min(1024 * 1024, max_bytes + 1)
            while True:
                maybe_coro = read_fn(chunk_size)
                chunk = await maybe_coro if inspect.isawaitable(maybe_coro) else maybe_coro
                if not chunk:
                    break
                if not isinstance(chunk, (bytes, bytearray, memoryview)):
                    raise DocumentAccessError(
                        f"Expected binary stream while reading {doc_label} PDF.",
                        status_code=status.HTTP_400_BAD_REQUEST,
                        code="INVALID_FILE_TYPE",
                    )
                chunk_bytes = bytes(chunk)
                total += len(chunk_bytes)
                if total > max_bytes:
                    limit_mb = f"{max_bytes / (1024 * 1024):.1f}"
                    raise DocumentAccessError(
                        f"{doc_label} PDF exceeds the {limit_mb} MB size limit.",
                        status_code=status.HTTP_400_BAD_REQUEST,
                        code="FILE_TOO_LARGE",
                    )
                chunks.append(chunk_bytes)
            return b"".join(chunks)

        maybe_coro = read_fn()
        data = await maybe_coro if inspect.isawaitable(maybe_coro) else maybe_coro
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise DocumentAccessError(
                f"Expected binary stream while reading {doc_label} PDF.",
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_FILE_TYPE",
            )
        return bytes(data)

    stream = getattr(upload_file, "file", None)
    if stream is not None and callable(getattr(stream, "read", None)):
        data = stream.read(max_bytes + 1)
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise DocumentAccessError(
                f"Expected binary file stream for {doc_label} PDF.",
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_FILE_TYPE",
            )
        return bytes(data)

    raise DocumentAccessError(
        f"No readable upload stream provided for {doc_label} PDF.",
        status_code=status.HTTP_400_BAD_REQUEST,
        code="EMPTY_FILE",
    )


async def validate_pdf_upload_and_extract(
    upload_file: Any,
    *,
    doc_type: Literal["jd", "resume"],
    max_bytes: int = DEFAULT_MAX_PDF_BYTES,
    min_chars: int = DEFAULT_MIN_EXTRACTED_CHARS,
) -> ValidatedPdfPayload:
    """Verify PDF file integrity (name, MIME, size, header/EOF, SHA-256) and extract clean text."""
    doc_label = "Job Description" if doc_type == "jd" else "Resume"
    extractor_doc_type: Literal["job_description", "resume"] = (
        "job_description" if doc_type == "jd" else "resume"
    )

    if upload_file is None:
        raise DocumentAccessError(
            f"Please select a {doc_label} PDF file to upload.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="EMPTY_FILE",
        )

    safe_filename = sanitize_pdf_filename(
        getattr(upload_file, "filename", None),
        doc_label=doc_label,
    )

    content_type = getattr(upload_file, "content_type", None)
    if content_type is not None and str(content_type).strip() != "":
        normalized_mime = str(content_type).split(";")[0].strip().lower()
        if normalized_mime not in ALLOWED_PDF_MIME_TYPES:
            raise DocumentAccessError(
                f"Invalid {doc_label} MIME type ({normalized_mime}). Expected application/pdf.",
                status_code=status.HTTP_400_BAD_REQUEST,
                code="INVALID_FILE_TYPE",
            )

    raw_bytes = await _read_upload_bytes_bounded(upload_file, max_bytes=max_bytes, doc_label=doc_label)
    if len(raw_bytes) == 0:
        raise DocumentAccessError(
            f"The uploaded {doc_label} PDF file is empty.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="EMPTY_FILE",
        )

    if len(raw_bytes) > max_bytes:
        limit_mb = f"{max_bytes / (1024 * 1024):.1f}"
        raise DocumentAccessError(
            f"{doc_label} PDF exceeds the {limit_mb} MB size limit.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="FILE_TOO_LARGE",
        )

    if b"%PDF-" not in raw_bytes[:1024]:
        raise DocumentAccessError(
            f"The uploaded {doc_label} file failed integrity validation (missing %PDF- signature).",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="CORRUPTED_PDF",
        )

    tail_window = raw_bytes[-2048:] if len(raw_bytes) > 2048 else raw_bytes
    if b"%%EOF" not in tail_window:
        raise DocumentAccessError(
            f"The uploaded {doc_label} PDF appears truncated or corrupted (missing %%EOF trailer).",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="CORRUPTED_PDF",
        )

    content_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    try:
        extracted = await asyncio.to_thread(
            extract_uploaded_pdf_text,
            raw_bytes,
            filename=safe_filename,
            content_type=content_type,
            document_type=extractor_doc_type,
            max_bytes=max_bytes,
            min_chars=min_chars,
        )
    except PdfExtractionError as exc:
        raise DocumentAccessError(
            exc.message,
            status_code=exc.status_code,
            code=exc.code,
        ) from exc

    return ValidatedPdfPayload(
        safe_filename=safe_filename,
        content_type=content_type,
        file_size_bytes=len(raw_bytes),
        content_sha256=content_sha256,
        page_count=extracted.page_count,
        raw_text=extracted.raw_text,
        normalized_text=extracted.text,
        char_count=extracted.char_count,
        word_count=extracted.word_count,
        engine=extracted.engine,
    )


def validate_pasted_jd_text(raw_text: str) -> tuple[str, str]:
    """Validate and clean pasted JD text, returning (normalized_text, content_sha256)."""
    if not isinstance(raw_text, str) or "\x00" in raw_text:
        raise DocumentAccessError(
            "Job Description text contains invalid binary characters.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="INVALID_TEXT",
        )

    normalized = clean_pdf_text(raw_text)
    if len(normalized) < DEFAULT_MIN_EXTRACTED_CHARS:
        raise DocumentAccessError(
            f"Job Description text is too short or empty. Provide at least {DEFAULT_MIN_EXTRACTED_CHARS} characters.",
            status_code=status.HTTP_400_BAD_REQUEST,
            code="TEXT_TOO_SHORT",
        )

    if len(normalized) > MAX_PASTED_JD_CHARS:
        normalized = normalized[:MAX_PASTED_JD_CHARS].rstrip()

    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return normalized, digest


def split_into_semantic_chunks(
    text: str,
    max_chunk_chars: int = 550,
    overlap_chars: int = 80,
) -> list[str]:
    """Split normalized document text into semantic retrieval chunks."""
    cleaned = clean_pdf_text(text)
    if not cleaned:
        return []

    paragraphs = [p.strip() for p in re.split(r"\n+", cleaned) if p.strip()]
    chunks: list[str] = []
    buffer = ""

    for para in paragraphs:
        if len(para) > max_chunk_chars:
            if buffer:
                chunks.append(buffer.strip())
                buffer = ""
            sentences = re.split(r"(?<=[.!?])\s+", para)
            sent_buf = ""
            for sentence in sentences:
                candidate = f"{sent_buf} {sentence}".strip() if sent_buf else sentence
                if len(candidate) <= max_chunk_chars:
                    sent_buf = candidate
                else:
                    if sent_buf:
                        chunks.append(sent_buf)
                    if len(sentence) > max_chunk_chars:
                        step = max(1, max_chunk_chars - overlap_chars)
                        for idx in range(0, len(sentence), step):
                            chunks.append(sentence[idx : idx + max_chunk_chars].strip())
                        sent_buf = ""
                    else:
                        sent_buf = sentence
            if sent_buf:
                chunks.append(sent_buf)
        else:
            candidate = f"{buffer}\n{para}".strip() if buffer else para
            if len(candidate) <= max_chunk_chars:
                buffer = candidate
            else:
                if buffer:
                    chunks.append(buffer.strip())
                buffer = para

    if buffer.strip():
        chunks.append(buffer.strip())

    return [c for c in chunks if len(c) >= 20]


def _extract_matched_skills(text: str) -> list[str]:
    lowered = text.lower()
    matched: list[str] = []
    for skill in COMMON_SKILL_CATALOG:
        pattern = r"(?<!\w)" + re.escape(skill.lower()) + r"(?!\w)"
        if re.search(pattern, lowered):
            matched.append(skill)
    return matched


def extract_basic_jd_analysis(normalized_text: str) -> dict[str, Any]:
    """Extract grounded JD metadata strictly from document lines without fabrication."""
    lines = [line.strip() for line in normalized_text.splitlines() if line.strip()]
    first_line = lines[0] if lines else "Unknown"
    job_title = first_line
    title_match = re.search(
        r"(?i)(?:job title|role|position|job description)\s*[:\-]\s*(.+)",
        first_line,
    )
    if title_match:
        job_title = title_match.group(1).strip()
    if len(job_title) > 100:
        job_title = "Unknown"

    exp_match = re.search(r"(\d+\+?\s*(?:to|-)\s*\d+\s*years|\d+\+?\s*years)", normalized_text, re.I)
    skills = _extract_matched_skills(normalized_text)
    responsibilities = [
        line.lstrip("-*• ").strip()
        for line in lines
        if re.match(r"^[-*•]\s+", line) or line.lower().startswith("responsibilit")
    ][:6]

    return {
        "jobTitle": job_title or "Unknown",
        "companyName": "Unknown",
        "requiredTechnicalSkills": skills,
        "preferredSkills": [],
        "responsibilities": responsibilities,
        "requiredExperience": exp_match.group(1) if exp_match else "Unknown",
        "toolsAndTechnologies": skills,
        "importantQualifications": [],
    }


def extract_basic_resume_analysis(normalized_text: str) -> dict[str, Any]:
    """Extract grounded resume metadata strictly from document lines without fabrication."""
    lines = [line.strip() for line in normalized_text.splitlines() if line.strip()]
    skills = _extract_matched_skills(normalized_text)
    education = [
        line for line in lines if re.search(r"\b(b\.?tech|b\.?e|m\.?tech|b\.?sc|m\.?sc|bachelor|master|university|college)\b", line, re.I)
    ][:4]
    experience_lines = [
        line for line in lines if re.search(r"\b(experience|engineer|developer|intern|architect|built|designed)\b", line, re.I)
    ][:4]

    return {
        "candidateSkills": skills,
        "workExperience": [
            {
                "role": "Experience Entry",
                "company": "Unknown",
                "duration": "Unknown",
                "highlights": experience_lines,
            }
        ]
        if experience_lines
        else [],
        "projects": [],
        "education": education,
        "technologiesUsed": skills,
        "achievements": [],
    }


def to_public_document_summary(doc: dict[str, Any]) -> dict[str, Any]:
    """Serialize internal stored document record to the public API summary shape."""
    normalized_text = str(doc.get("normalizedText", ""))
    preview_text = (
        normalized_text[:750] + "..." if len(normalized_text) > 750 else normalized_text
    )
    chunk_ids = doc.get("chunkIds") or []
    return {
        "id": doc["id"],
        "userId": doc["userId"],
        "docType": doc["docType"],
        "sourceType": doc["sourceType"],
        "fileName": doc.get("fileName"),
        "fileSizeBytes": doc.get("fileSizeBytes"),
        "pageCount": doc.get("pageCount"),
        "charCount": doc.get("charCount", len(normalized_text)),
        "contentSha256": doc.get("contentSha256"),
        "normalizedText": normalized_text,
        "previewText": preview_text,
        "analysis": doc.get("analysis") or {},
        "webResearchSummary": doc.get("webResearchSummary"),
        "webSources": doc.get("webSources") or [],
        "webResearchStatus": doc.get("webResearchStatus") or "skipped",
        "chunkCount": len(chunk_ids),
        "createdAt": doc["createdAt"],
    }


class DocumentRepository:
    """User-isolated document persistence compatible with `documents_d3.json`."""

    CURRENT_SCHEMA_VERSION = 2

    def __init__(self, data_dir: os.PathLike[str] | str = "data") -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.file_path = self.data_dir / "documents_d3.json"

    def _load_all(self) -> list[dict[str, Any]]:
        if not self.file_path.is_file():
            return []
        try:
            raw = json.loads(self.file_path.read_text(encoding="utf-8"))
            return raw if isinstance(raw, list) else []
        except (OSError, json.JSONDecodeError):
            return []

    def _save_all(self, records: list[dict[str, Any]]) -> None:
        self.file_path.write_text(json.dumps(records, indent=2), encoding="utf-8")

    def create_document(
        self,
        *,
        user_id: str,
        doc_type: Literal["jd", "resume"],
        source_type: Literal["pdf", "text"],
        normalized_text: str,
        raw_text: str,
        content_sha256: str,
        analysis: dict[str, Any],
        file_name: Optional[str] = None,
        file_size_bytes: Optional[int] = None,
        page_count: Optional[int] = None,
        web_research_status: Literal["completed", "skipped", "unavailable"] = "skipped",
    ) -> dict[str, Any]:
        if not user_id or not str(user_id).strip():
            raise DocumentAccessError(
                "Document must be associated with an authenticated user ID.",
                status_code=status.HTTP_401_UNAUTHORIZED,
                code="UNAUTHENTICATED",
            )

        prefix = "jd_" if doc_type == "jd" else "res_"
        doc_id = f"{prefix}{uuid.uuid4()}"
        chunks = split_into_semantic_chunks(normalized_text)
        if not chunks and normalized_text:
            chunks = [normalized_text[:600]]
        chunk_ids = [f"{doc_id}_chk_{idx}" for idx in range(len(chunks))]

        record: dict[str, Any] = {
            "id": doc_id,
            "schemaVersion": self.CURRENT_SCHEMA_VERSION,
            "userId": str(user_id),
            "docType": doc_type,
            "sourceType": source_type,
            "fileName": file_name,
            "fileSizeBytes": file_size_bytes,
            "pageCount": page_count,
            "charCount": len(normalized_text),
            "contentSha256": content_sha256,
            "rawText": raw_text,
            "normalizedText": normalized_text,
            "analysis": analysis,
            "webResearchSummary": "",
            "webSources": [],
            "webResearchStatus": web_research_status,
            "chunkIds": chunk_ids,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

        records = self._load_all()
        records.insert(0, record)
        self._save_all(records)
        return record

    def get_document_for_user(self, doc_id: str, user_id: str) -> dict[str, Any]:
        records = self._load_all()
        match = next((doc for doc in records if doc.get("id") == doc_id), None)
        if match is None:
            raise DocumentAccessError(
                "Document not found.",
                status_code=status.HTTP_404_NOT_FOUND,
                code="DOCUMENT_NOT_FOUND",
            )
        if match.get("userId") != user_id:
            raise DocumentAccessError(
                "Forbidden: You do not have permission to access this document.",
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN_DOCUMENT_ACCESS",
            )
        return match

    def get_latest_for_user(
        self,
        user_id: str,
        doc_type: Literal["jd", "resume"],
        preferred_id: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        records = self._load_all()
        if preferred_id:
            preferred = next(
                (
                    doc
                    for doc in records
                    if doc.get("id") == preferred_id
                    and doc.get("userId") == user_id
                    and doc.get("docType") == doc_type
                ),
                None,
            )
            if preferred is not None:
                return preferred

        return next(
            (
                doc
                for doc in records
                if doc.get("userId") == user_id and doc.get("docType") == doc_type
            ),
            None,
        )

    def list_for_user(
        self,
        user_id: str,
        doc_type: Optional[Literal["jd", "resume"]] = None,
    ) -> list[dict[str, Any]]:
        records = self._load_all()
        return [
            doc
            for doc in records
            if doc.get("userId") == user_id
            and (doc_type is None or doc.get("docType") == doc_type)
        ]

    def delete_document_for_user(self, doc_id: str, user_id: str) -> dict[str, Any]:
        records = self._load_all()
        target_idx: Optional[int] = None
        target_doc: Optional[dict[str, Any]] = None
        for idx, doc in enumerate(records):
            if doc.get("id") == doc_id:
                target_idx = idx
                target_doc = doc
                break

        if target_doc is None or target_idx is None:
            raise DocumentAccessError(
                "Document not found.",
                status_code=status.HTTP_404_NOT_FOUND,
                code="DOCUMENT_NOT_FOUND",
            )
        if target_doc.get("userId") != user_id:
            raise DocumentAccessError(
                "Forbidden: You cannot delete another user's document.",
                status_code=status.HTTP_403_FORBIDDEN,
                code="FORBIDDEN_DOCUMENT_ACCESS",
            )

        records.pop(target_idx)
        self._save_all(records)
        return target_doc


_default_document_repo: Optional[DocumentRepository] = None


def get_document_repository(request: Optional[Request] = None) -> DocumentRepository:
    """Resolve the active DocumentRepository from FastAPI app state or default data dir."""
    if request is not None:
        app_state = getattr(getattr(request, "app", None), "state", None)
        repo = getattr(app_state, "document_repo", None)
        if isinstance(repo, DocumentRepository):
            return repo

    global _default_document_repo
    if _default_document_repo is None:
        _default_document_repo = DocumentRepository(os.environ.get("DATA_DIR", "data"))
    return _default_document_repo
