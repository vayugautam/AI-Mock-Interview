import logging
import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.dependencies import get_database_session
from app.models import User
from app.schemas.evaluation import EvaluationMetadata, EvaluationResponse
from app.services.answer_service import get_session_question, get_session_question_answer
from app.services.evaluation_provider import evaluation_provider
from app.services.evaluation_context_service import assemble_evaluation_context
from app.services.evaluation_service import (
    OVERALL_SCORE_METHOD,
    EvaluationAlreadyExistsError,
    EvaluationProviderResponseError,
    EvaluationProviderUnavailableError,
    create_evaluation,
    get_session_answer,
)
from app.services.interview_service import get_user_interview_session

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/interviews", tags=["evaluations"])


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


def ensure_session_accepts_evaluation(interview_session) -> None:
    if interview_session.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot evaluate answers for a completed interview session",
        )


def persist_evaluation(
    db: Session,
    *,
    answer,
    question,
    interview_session,
) -> EvaluationResponse:
    try:
        evaluation = create_evaluation(
            db,
            answer=answer,
            question=question,
            provider=evaluation_provider,
            interview_type=interview_session.interview_type,
            difficulty=interview_session.difficulty,
            context=assemble_evaluation_context(
                db,
                interview_session=interview_session,
                question=question,
            ),
        )
        db.commit()
        db.refresh(evaluation)
        return EvaluationResponse.model_validate(
            {
                **{
                    field: getattr(evaluation, field)
                    for field in EvaluationResponse.model_fields
                    if field != "metadata"
                },
                "metadata": EvaluationMetadata(
                    provider=evaluation_provider.provider_name,
                    is_ai_generated=getattr(evaluation_provider, "is_ai_generated", False),
                    scoring_method=OVERALL_SCORE_METHOD,
                    model=getattr(evaluation_provider, "model", None),
                ),
                "reasoning": evaluation.reasoning,
                "strengths": json.loads(evaluation.strengths or "[]"),
                "weaknesses": json.loads(evaluation.weaknesses or "[]"),
                "missing_concepts": json.loads(evaluation.missing_concepts or "[]"),
                "improvement_suggestions": json.loads(evaluation.improvement_suggestions or "[]"),
                "is_off_topic": bool(evaluation.is_off_topic),
            }
        )
    except EvaluationAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An evaluation already exists for this answer",
        ) from exc
    except IntegrityError as exc:
        db.rollback()
        logger.info("Evaluation creation conflicted with an existing evaluation")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An evaluation already exists for this answer",
        ) from exc
    except EvaluationProviderUnavailableError as exc:
        logger.warning("Evaluation provider was unavailable")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Evaluation provider is temporarily unavailable",
        ) from exc
    except EvaluationProviderResponseError as exc:
        logger.warning("Evaluation provider returned an invalid result")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Evaluation provider returned an invalid result",
        ) from exc
    except RuntimeError as exc:
        db.rollback()
        logger.warning("Evaluation provider is not configured")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Evaluation provider is temporarily unavailable",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to store answer evaluation")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to store answer evaluation",
        ) from exc


@router.post(
    "/{session_id}/answers/{answer_id}/evaluation",
    response_model=EvaluationResponse,
    status_code=status.HTTP_201_CREATED,
)
def evaluate_answer(
    session_id: int,
    answer_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> EvaluationResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    ensure_session_accepts_evaluation(interview_session)
    answer = get_session_answer(db, session_id=interview_session.id, answer_id=answer_id)
    if answer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Answer not found for this interview session",
        )
    question = get_session_question(
        db,
        session_id=interview_session.id,
        question_id=answer.question_id,
    )
    if question is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Question not found for this interview session",
        )

    return persist_evaluation(
        db,
        answer=answer,
        question=question,
        interview_session=interview_session,
    )


@router.post(
    "/{session_id}/questions/{question_id}/evaluate",
    response_model=EvaluationResponse,
    status_code=status.HTTP_201_CREATED,
)
def evaluate_question_answer(
    session_id: int,
    question_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> EvaluationResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    ensure_session_accepts_evaluation(interview_session)
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
    return persist_evaluation(
        db,
        answer=answer,
        question=question,
        interview_session=interview_session,
    )
