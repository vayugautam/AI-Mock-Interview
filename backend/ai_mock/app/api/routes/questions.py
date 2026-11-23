import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.core.config import get_settings
from app.db.dependencies import get_database_session
from app.models import User
from app.schemas.question import (
    QuestionCollectionResponse,
    QuestionGenerationRequest,
)
from app.services.interview_service import get_user_interview_session
from app.services.question_provider import question_provider
from app.services.groq_question_provider import GroqQuestionProvider
from app.services.question_context_service import assemble_question_context
from app.services.question_service import (
    QuestionGenerationNotAllowedError,
    QuestionsAlreadyGeneratedError,
    create_initial_questions,
    list_session_questions,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/interviews", tags=["questions"])


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


@router.get("/{session_id}/questions", response_model=QuestionCollectionResponse)
def list_questions(
    session_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> QuestionCollectionResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    return QuestionCollectionResponse(
        generation_source=(
            "groq"
            if get_settings().question_generation_provider.lower() == "groq"
            else question_provider.generation_source
        ),
        questions=list_session_questions(db, session_id=interview_session.id),
    )


@router.post(
    "/{session_id}/questions",
    response_model=QuestionCollectionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_questions(
    session_id: int,
    request: QuestionGenerationRequest,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> QuestionCollectionResponse:
    interview_session = get_owned_interview_or_404(
        db,
        user_id=current_user.id,
        session_id=session_id,
    )
    try:
        provider = _configured_question_provider()
        context = assemble_question_context(db, interview_session=interview_session)
        number_of_questions = request.number_of_questions or interview_session.question_count
        questions = create_initial_questions(
            db,
            interview_session=interview_session,
            number_of_questions=number_of_questions,
            provider=provider,
            context=context,
        )
        db.commit()
        return QuestionCollectionResponse(
            generation_source=provider.generation_source,
            questions=questions,
        )
    except QuestionGenerationNotAllowedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Questions can only be generated while the interview session is created",
        ) from exc
    except QuestionsAlreadyGeneratedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Questions have already been generated for this interview session",
        ) from exc
    except IntegrityError as exc:
        db.rollback()
        logger.info("Question generation conflicted with an existing question set")
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Questions have already been generated for this interview session",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to create interview questions")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to create interview questions",
        ) from exc
    except (TimeoutError, RuntimeError, ValueError) as exc:
        db.rollback()
        logger.warning("Question generation provider failed: %s", str(exc))
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Question generation is temporarily unavailable",
        ) from exc


def _configured_question_provider():
    settings = get_settings()
    if settings.question_generation_provider.lower() == "groq":
        return GroqQuestionProvider(settings)
    if settings.question_generation_provider.lower() == "predefined":
        return question_provider
    raise RuntimeError("QUESTION_GENERATION_PROVIDER must be either predefined or groq")
