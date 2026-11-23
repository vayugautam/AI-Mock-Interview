import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.dependencies import get_database_session
from app.models import User
from app.schemas.answer import AnswerCollectionResponse, AnswerCreate, AnswerResponse
from app.services.answer_service import (
    get_session_question_answer,
    get_session_question,
    list_session_answers,
    submit_answer,
)
from app.services.interview_service import get_user_interview_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/interviews", tags=["answers"])


def get_owned_interview_or_404(db: Session, *, user_id: int, session_id: int):
    interview_session = get_user_interview_session(
        db,
        user_id=user_id,
        session_id=session_id,
    )
    if interview_session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found",
        )
    return interview_session


@router.get("/{session_id}/answers", response_model=AnswerCollectionResponse)
def list_answers(
    session_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> AnswerCollectionResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    return AnswerCollectionResponse(
        answers=list_session_answers(db, session_id=interview_session.id)
    )


@router.get("/{session_id}/questions/{question_id}/answer", response_model=AnswerResponse)
def get_answer(
    session_id: int,
    question_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> AnswerResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    question = get_session_question(
        db,
        session_id=interview_session.id,
        question_id=question_id,
    )
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found for this interview session",
        )
    answer = get_session_question_answer(
        db,
        session_id=interview_session.id,
        question_id=question.id,
    )
    if answer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Answer not found for this interview question",
        )
    return answer


@router.post(
    "/{session_id}/questions/{question_id}/answer",
    response_model=AnswerResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_answer(
    session_id: int,
    question_id: int,
    answer_data: AnswerCreate,
    response: Response,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> AnswerResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    if interview_session.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot submit answers to a completed interview session",
        )

    question = get_session_question(
        db,
        session_id=interview_session.id,
        question_id=question_id,
    )
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found for this interview session",
        )

    try:
        answer, created = submit_answer(
            db,
            session_id=interview_session.id,
            question_id=question.id,
            answer_data=answer_data,
        )
        db.commit()
        db.refresh(answer)
        if not created:
            response.status_code = status.HTTP_200_OK
        return answer
    except IntegrityError as exc:
        db.rollback()
        logger.info("Answer save conflicted with an existing answer")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Unable to save answer because another submission is in progress",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to submit interview answer")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to submit interview answer",
        ) from exc
