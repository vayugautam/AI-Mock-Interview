from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Answer, Question
from app.schemas.answer import AnswerCreate


def get_session_question(
    db: Session,
    *,
    session_id: int,
    question_id: int,
) -> Question | None:
    statement = select(Question).where(
        Question.id == question_id,
        Question.session_id == session_id,
    )
    return db.scalar(statement)


def list_session_answers(db: Session, *, session_id: int) -> list[Answer]:
    statement = (
        select(Answer)
        .join(Question, Answer.question_id == Question.id)
        .where(Answer.session_id == session_id)
        .order_by(Question.sequence_number.asc(), Answer.id.asc())
    )
    return list(db.scalars(statement))


def get_session_question_answer(
    db: Session,
    *,
    session_id: int,
    question_id: int,
) -> Answer | None:
    statement = select(Answer).where(
        Answer.session_id == session_id,
        Answer.question_id == question_id,
    )
    return db.scalar(statement)


def submit_answer(
    db: Session,
    *,
    session_id: int,
    question_id: int,
    answer_data: AnswerCreate,
) -> tuple[Answer, bool]:
    existing_answer = db.scalar(select(Answer).where(Answer.question_id == question_id))
    if existing_answer is not None:
        existing_answer.answer_text = answer_data.answer_text
        db.flush()
        return existing_answer, False

    answer = Answer(
        session_id=session_id,
        question_id=question_id,
        answer_text=answer_data.answer_text,
    )
    db.add(answer)
    db.flush()
    return answer, True
