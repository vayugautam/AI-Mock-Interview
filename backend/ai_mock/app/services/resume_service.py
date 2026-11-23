from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import UploadFile
from pypdf import PdfReader
from pypdf.errors import PdfReadError, PdfStreamError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models import Resume

ALLOWED_CONTENT_TYPE = "application/pdf"
PDF_SIGNATURE = b"%PDF-"


class ResumeValidationError(Exception):
    """Raised when an uploaded resume is not a readable, supported PDF."""


class ResumeStorageError(Exception):
    """Raised when a resume cannot be stored safely."""


def _storage_root(settings: Settings) -> Path:
    root = Path(settings.resume_storage_dir)
    if not root.is_absolute():
        root = Path(__file__).resolve().parents[2] / root
    return root


def get_user_resume(db: Session, *, user_id: int) -> Resume | None:
    return db.scalar(select(Resume).where(Resume.user_id == user_id))


async def store_and_extract_resume(
    upload: UploadFile,
    *,
    settings: Settings | None = None,
) -> tuple[str, str, int]:
    current_settings = settings or get_settings()
    filename = upload.filename or ""
    if Path(filename).suffix.lower() != ".pdf":
        raise ResumeValidationError("Only PDF resumes are supported")
    if upload.content_type != ALLOWED_CONTENT_TYPE:
        raise ResumeValidationError("The uploaded file must have MIME type application/pdf")

    root = _storage_root(current_settings)
    stored_filename = f"{uuid.uuid4().hex}.pdf"
    destination = root / stored_filename
    total_size = 0
    try:
        root.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as target:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > current_settings.resume_max_size_bytes:
                    raise ResumeValidationError("Resume exceeds the maximum allowed file size")
                target.write(chunk)
        if total_size == 0:
            raise ResumeValidationError("The uploaded resume is empty")
        with destination.open("rb") as source:
            if source.read(len(PDF_SIGNATURE)) != PDF_SIGNATURE:
                raise ResumeValidationError("The uploaded file is not a valid PDF")
        reader = PdfReader(str(destination), strict=True)
        if reader.is_encrypted:
            raise ResumeValidationError("Encrypted PDFs are not supported")
        extracted_text = "\n".join(page.extract_text() or "" for page in reader.pages).strip()
        if not extracted_text:
            raise ResumeValidationError("The PDF does not contain readable text")
        return stored_filename, extracted_text, total_size
    except ResumeValidationError:
        destination.unlink(missing_ok=True)
        raise
    except (PdfReadError, PdfStreamError) as exc:
        destination.unlink(missing_ok=True)
        raise ResumeValidationError("The uploaded PDF is malformed or unreadable") from exc
    except (OSError, ValueError, TypeError) as exc:
        destination.unlink(missing_ok=True)
        raise ResumeStorageError("Unable to store or read the uploaded resume") from exc
    finally:
        await upload.close()


def save_user_resume(
    db: Session,
    *,
    user_id: int,
    original_filename: str,
    stored_filename: str,
    file_size_bytes: int,
    extracted_text: str,
) -> tuple[Resume, str | None]:
    existing = get_user_resume(db, user_id=user_id)
    old_stored_filename = existing.stored_filename if existing else None
    if existing is None:
        existing = Resume(
            user_id=user_id,
            original_filename=_safe_filename(original_filename),
            stored_filename=stored_filename,
            content_type=ALLOWED_CONTENT_TYPE,
            file_size_bytes=file_size_bytes,
            extracted_text=extracted_text,
            processing_status="ready",
        )
        db.add(existing)
    else:
        existing.original_filename = _safe_filename(original_filename)
        existing.stored_filename = stored_filename
        existing.content_type = ALLOWED_CONTENT_TYPE
        existing.file_size_bytes = file_size_bytes
        existing.extracted_text = extracted_text
        existing.processing_status = "ready"
    db.flush()
    return existing, old_stored_filename


def delete_stored_resume(stored_filename: str, *, settings: Settings | None = None) -> None:
    if not re.fullmatch(r"[a-f0-9]{32}\.pdf", stored_filename):
        raise ResumeStorageError("Invalid stored resume filename")
    try:
        _storage_root(settings or get_settings()).joinpath(stored_filename).unlink(missing_ok=True)
    except OSError as exc:
        raise ResumeStorageError("Unable to clean up stored resume") from exc


def _safe_filename(filename: str) -> str:
    normalized = Path(filename).name
    return normalized[:255] or "resume.pdf"
