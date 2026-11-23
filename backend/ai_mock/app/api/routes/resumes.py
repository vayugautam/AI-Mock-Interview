import logging

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.config import get_settings
from app.db.dependencies import get_database_session
from app.models import User
from app.schemas.resume import ResumeResponse
from app.services.resume_service import (
    ResumeStorageError,
    ResumeValidationError,
    delete_stored_resume,
    get_user_resume,
    save_user_resume,
    store_and_extract_resume,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/resumes", tags=["resumes"])


@router.post("/upload", response_model=ResumeResponse, status_code=status.HTTP_201_CREATED)
async def upload_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    settings = get_settings()
    stored_filename: str | None = None
    try:
        stored_filename, extracted_text, file_size = await store_and_extract_resume(
            file,
            settings=settings,
        )
        resume, old_stored_filename = save_user_resume(
            db,
            user_id=current_user.id,
            original_filename=file.filename or "resume.pdf",
            stored_filename=stored_filename,
            file_size_bytes=file_size,
            extracted_text=extracted_text,
        )
        db.commit()
        db.refresh(resume)
        if old_stored_filename:
            try:
                delete_stored_resume(old_stored_filename, settings=settings)
            except ResumeStorageError:
                logger.warning("Unable to remove replaced resume file for user %s", current_user.id)
        return resume
    except ResumeValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ResumeStorageError as exc:
        logger.warning("Resume upload failed for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Resume storage is temporarily unavailable",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        if stored_filename:
            try:
                delete_stored_resume(stored_filename, settings=settings)
            except ResumeStorageError:
                logger.warning("Unable to clean up failed resume upload for user %s", current_user.id)
        logger.exception("Unable to persist resume metadata for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save resume",
        ) from exc


@router.get("/me", response_model=ResumeResponse | None, status_code=status.HTTP_200_OK)
def get_my_resume(
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    resume = get_user_resume(db, user_id=current_user.id)
    if resume is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return resume
