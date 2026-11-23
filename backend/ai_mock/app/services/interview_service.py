import hashlib
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InterviewSession
from app.schemas.interview import InterviewSessionCreate


class InvalidInterviewStatusTransitionError(Exception):
    """Raised when an interview cannot transition to completed."""


def create_interview_session(
    db: Session,
    *,
    user_id: int,
    interview_data: InterviewSessionCreate,
) -> InterviewSession:
    interview_session = InterviewSession(
        user_id=user_id,
        resume_id=interview_data.resume_id,
        role=interview_data.role,
        difficulty=interview_data.difficulty,
        interview_type=interview_data.interview_type,
        status="created",
        company_name=interview_data.company_name,
        country_region=interview_data.country_region,
        job_description_url=interview_data.job_description_url,
        job_description_text=interview_data.job_description_text,
        job_description_fingerprint=(
            hashlib.sha256(
                "\n".join(
                    [
                        str(interview_data.job_description_url or ""),
                        interview_data.job_description_text or "",
                    ]
                ).encode("utf-8")
            ).hexdigest()
            if interview_data.job_description_url or interview_data.job_description_text
            else None
        ),
        question_count=interview_data.number_of_questions,
    )
    db.add(interview_session)
    db.flush()
    return interview_session


def list_user_interview_sessions(db: Session, *, user_id: int) -> list[InterviewSession]:
    statement = (
        select(InterviewSession)
        .where(InterviewSession.user_id == user_id)
        .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
    )
    return list(db.scalars(statement))


def get_user_interview_session(
    db: Session,
    *,
    user_id: int,
    session_id: int,
) -> InterviewSession | None:
    statement = select(InterviewSession).where(
        InterviewSession.id == session_id,
        InterviewSession.user_id == user_id,
    )
    return db.scalar(statement)


def complete_interview_session(db: Session, *, interview_session: InterviewSession) -> bool:
    """Transition a created session to completed, returning whether it was already completed."""
    if interview_session.status == "completed":
        return True
    if interview_session.status != "created":
        raise InvalidInterviewStatusTransitionError

    interview_session.status = "completed"
    db.flush()
    return False
