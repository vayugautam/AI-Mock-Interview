import json

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Answer, InterviewSession, Question
from app.schemas.results import (
    InterviewResultsResponse,
    QuestionResultResponse,
    StoredEvaluationResponse,
)


def get_interview_results(
    db: Session,
    *,
    user_id: int,
    session_id: int,
) -> InterviewResultsResponse | None:
    statement = (
        select(InterviewSession)
        .where(InterviewSession.id == session_id, InterviewSession.user_id == user_id)
        .options(
            selectinload(InterviewSession.questions)
            .selectinload(Question.answers)
            .selectinload(Answer.evaluation)
        )
    )
    interview_session = db.scalar(statement)
    if interview_session is None:
        return None

    questions = []
    for question in sorted(interview_session.questions, key=lambda item: (item.sequence_number, item.id)):
        answer = question.answers[0] if question.answers else None
        evaluation = answer.evaluation if answer is not None else None
        questions.append(
            QuestionResultResponse(
                id=question.id,
                sequence_number=question.sequence_number,
                question_text=question.question_text,
                answer_id=answer.id if answer else None,
                answer_text=answer.answer_text if answer else None,
                answered_at=answer.created_at if answer else None,
                evaluation=(
                    StoredEvaluationResponse(
                        id=evaluation.id,
                        correctness_score=evaluation.correctness_score,
                        relevance_score=evaluation.relevance_score,
                        clarity_score=evaluation.clarity_score,
                        completeness_score=evaluation.completeness_score,
                        overall_score=evaluation.overall_score,
                        feedback=evaluation.feedback,
                        created_at=evaluation.created_at,
                        reasoning=evaluation.reasoning,
                        strengths=json.loads(evaluation.strengths or "[]"),
                        weaknesses=json.loads(evaluation.weaknesses or "[]"),
                        missing_concepts=json.loads(evaluation.missing_concepts or "[]"),
                        improvement_suggestions=json.loads(evaluation.improvement_suggestions or "[]"),
                        is_off_topic=bool(evaluation.is_off_topic),
                        provider=evaluation.provider,
                        model=evaluation.model,
                    )
                    if evaluation
                    else None
                ),
                topic=question.topic,
                difficulty=question.difficulty,
                category=question.category,
                source_type=question.source_type,
                source_references=json.loads(question.source_references or "[]"),
            )
        )
    return InterviewResultsResponse(
        id=interview_session.id,
        role=interview_session.role,
        difficulty=interview_session.difficulty,
        interview_type=interview_session.interview_type,
        status=interview_session.status,
        questions=questions,
    )
