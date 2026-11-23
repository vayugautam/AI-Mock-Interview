from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InterviewSession, Question
from app.services.question_provider import QuestionDraft, QuestionProvider
import json


class QuestionsAlreadyGeneratedError(Exception):
    """Raised when an interview already has its initial question set."""


class QuestionGenerationNotAllowedError(Exception):
    """Raised when an interview is no longer in its initial created state."""


def list_session_questions(db: Session, *, session_id: int) -> list[Question]:
    statement = (
        select(Question)
        .where(Question.session_id == session_id)
        .order_by(Question.sequence_number.asc(), Question.id.asc())
    )
    return list(db.scalars(statement))


def create_initial_questions(
    db: Session,
    *,
    interview_session: InterviewSession,
    number_of_questions: int,
    provider: QuestionProvider,
    context: object | None = None,
) -> list[Question]:
    if interview_session.status != "created":
        raise QuestionGenerationNotAllowedError

    if list_session_questions(db, session_id=interview_session.id):
        raise QuestionsAlreadyGeneratedError

    questions = [
        _question_from_draft(
            interview_session.id,
            sequence_number,
            question_text,
        )
        for sequence_number, question_text in enumerate(
            provider.generate(interview_session, number_of_questions, context),
            start=1,
        )
    ]
    db.add_all(questions)
    db.flush()
    return questions


def _question_from_draft(
    session_id: int,
    sequence_number: int,
    draft: str | QuestionDraft,
) -> Question:
    if isinstance(draft, str):
        return Question(
            session_id=session_id,
            question_text=draft,
            sequence_number=sequence_number,
        )
    return Question(
        session_id=session_id,
        question_text=draft.question_text,
        sequence_number=sequence_number,
        topic=draft.topic,
        difficulty=draft.difficulty,
        category=draft.category,
        source_type=draft.source_type,
        source_references=json.dumps(list(draft.source_references)),
        model_answer=draft.model_answer,
    )
