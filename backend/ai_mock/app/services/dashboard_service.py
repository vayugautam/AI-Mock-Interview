from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import Answer, Evaluation, InterviewSession
from app.schemas.dashboard import (
    DashboardProgressResponse,
    DashboardSummaryResponse,
    PerformanceHistoryItem,
    RecentInterviewResponse,
)

AVERAGE_SCORE_METHOD = "Arithmetic mean of all stored overall evaluation scores for the current user, rounded to two decimal places."


def get_dashboard_summary(db: Session, *, user_id: int) -> DashboardSummaryResponse:
    interview_counts = db.execute(
        select(
            func.count(InterviewSession.id),
            func.coalesce(
                func.sum(case((InterviewSession.status == "completed", 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((InterviewSession.status == "created", 1), else_=0)),
                0,
            ),
        ).where(InterviewSession.user_id == user_id)
    ).one()
    total_answered_questions = db.scalar(
        select(func.count(Answer.id))
        .join(InterviewSession, Answer.session_id == InterviewSession.id)
        .where(InterviewSession.user_id == user_id)
    )
    average_score = db.scalar(
        select(func.avg(Evaluation.overall_score))
        .join(Answer, Evaluation.answer_id == Answer.id)
        .join(InterviewSession, Answer.session_id == InterviewSession.id)
        .where(InterviewSession.user_id == user_id)
    )
    recent_sessions = list(
        db.scalars(
            select(InterviewSession)
            .where(InterviewSession.user_id == user_id)
            .order_by(InterviewSession.created_at.desc(), InterviewSession.id.desc())
            .limit(5)
        )
    )
    return DashboardSummaryResponse(
        total_interviews=int(interview_counts[0]),
        completed_interviews=int(interview_counts[1]),
        in_progress_interviews=int(interview_counts[2]),
        total_answered_questions=int(total_answered_questions or 0),
        average_overall_score=(
            Decimal(str(average_score)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if average_score is not None
            else None
        ),
        recent_interviews=[
            RecentInterviewResponse(
                id=session.id,
                role=session.role,
                difficulty=session.difficulty,
                interview_type=session.interview_type,
                status=session.status,
                created_at=session.created_at,
            )
            for session in recent_sessions
        ],
    )


def get_dashboard_progress(db: Session, *, user_id: int) -> DashboardProgressResponse:
    rows = db.execute(
        select(Evaluation, Answer.session_id, Evaluation.created_at)
        .join(Answer, Evaluation.answer_id == Answer.id)
        .join(InterviewSession, Answer.session_id == InterviewSession.id)
        .where(InterviewSession.user_id == user_id)
        .order_by(Evaluation.created_at.asc(), Evaluation.id.asc())
    ).all()
    return DashboardProgressResponse(
        progress=[
            PerformanceHistoryItem(
                evaluated_at=created_at,
                session_id=session_id,
                answer_id=evaluation.answer_id,
                correctness_score=evaluation.correctness_score,
                relevance_score=evaluation.relevance_score,
                clarity_score=evaluation.clarity_score,
                completeness_score=evaluation.completeness_score,
                overall_score=evaluation.overall_score,
            )
            for evaluation, session_id, created_at in rows
        ]
    )
