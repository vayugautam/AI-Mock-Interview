import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.dependencies import get_database_session
from app.models import InterviewSession, Resume, User
from app.schemas.interview import (
    InterviewCompletionResponse,
    InterviewSessionCreate,
    InterviewSessionResponse,
    InterviewStatusResponse,
)
from app.services.interview_service import (
    InvalidInterviewStatusTransitionError,
    complete_interview_session,
    create_interview_session,
    get_user_interview_session,
    list_user_interview_sessions,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/interviews", tags=["interviews"])


@router.post("", response_model=InterviewSessionResponse, status_code=status.HTTP_201_CREATED)
def create_interview(
    interview_data: InterviewSessionCreate,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> InterviewSession:
    try:
        if interview_data.resume_id is not None:
            resume = db.scalar(
                select(Resume).where(
                    Resume.id == interview_data.resume_id,
                    Resume.user_id == current_user.id,
                )
            )
            if resume is None:
                raise HTTPException(status_code=404, detail="Resume not found")
        interview_session = create_interview_session(
            db,
            user_id=current_user.id,
            interview_data=interview_data,
        )
        db.commit()
        db.refresh(interview_session)
        return interview_session
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to create interview session")
        if isinstance(exc, OperationalError):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database is temporarily unavailable. Please retry shortly.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to create interview session",
        ) from exc


@router.get("", response_model=list[InterviewSessionResponse])
def list_interviews(
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> list[InterviewSession]:
    return list_user_interview_sessions(db, user_id=current_user.id)


@router.get("/{session_id}", response_model=InterviewSessionResponse)
def get_interview(
    session_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> InterviewSession:
    interview_session = get_user_interview_session(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    if interview_session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found",
        )
    return interview_session


@router.get("/{session_id}/status", response_model=InterviewStatusResponse)
def get_interview_status(
    session_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> InterviewStatusResponse:
    interview_session = get_user_interview_session(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    if interview_session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found",
        )
    return InterviewStatusResponse(id=interview_session.id, status=interview_session.status)


@router.post("/{session_id}/complete", response_model=InterviewCompletionResponse)
def complete_interview(
    session_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> InterviewCompletionResponse:
    interview_session = get_user_interview_session(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    if interview_session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found",
        )

    try:
        already_completed = complete_interview_session(
            db,
            interview_session=interview_session,
        )
        if not already_completed:
            db.commit()
            db.refresh(interview_session)
        return InterviewCompletionResponse(
            id=interview_session.id,
            status=interview_session.status,
            already_completed=already_completed,
        )
    except InvalidInterviewStatusTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Interview session cannot be completed from its current status",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to complete interview session")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to complete interview session",
        ) from exc
