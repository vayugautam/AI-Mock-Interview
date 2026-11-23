import json
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Answer, Evaluation, Question
from app.schemas.evaluation import EvaluationCriteria
from app.services.evaluation_provider import EvaluationProvider
from app.services.evaluation_context_service import EvaluationContext

OVERALL_SCORE_METHOD = (
    "Provisional, uncalibrated rubric: 0.35 correctness + 0.25 relevance + "
    "0.25 completeness + 0.15 clarity, rounded to two decimal places."
)
EVALUATION_WEIGHTS = {
    "correctness_score": Decimal("0.35"),
    "relevance_score": Decimal("0.25"),
    "completeness_score": Decimal("0.25"),
    "clarity_score": Decimal("0.15"),
}


class EvaluationAlreadyExistsError(Exception):
    """Raised when an answer already has an evaluation."""


class EvaluationProviderUnavailableError(Exception):
    """Raised when the evaluation provider cannot complete a request."""


class EvaluationProviderResponseError(Exception):
    """Raised when a provider returns an invalid evaluation payload."""


def get_session_answer(
    db: Session,
    *,
    session_id: int,
    answer_id: int,
) -> Answer | None:
    statement = select(Answer).where(
        Answer.id == answer_id,
        Answer.session_id == session_id,
    )
    return db.scalar(statement)


def calculate_overall_score(criteria: EvaluationCriteria) -> Decimal:
    total = (
        EVALUATION_WEIGHTS["correctness_score"] * criteria.correctness_score
        + EVALUATION_WEIGHTS["relevance_score"] * criteria.relevance_score
        + EVALUATION_WEIGHTS["completeness_score"] * criteria.completeness_score
        + EVALUATION_WEIGHTS["clarity_score"] * criteria.clarity_score
    )
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def create_evaluation(
    db: Session,
    *,
    answer: Answer,
    question: Question,
    provider: EvaluationProvider,
    interview_type: str = "technical",
    difficulty: str = "intermediate",
    context: EvaluationContext | None = None,
) -> Evaluation:
    if answer.evaluation is not None or db.scalar(
        select(Evaluation.id).where(Evaluation.answer_id == answer.id)
    ) is not None:
        raise EvaluationAlreadyExistsError

    try:
        provider_result = provider.evaluate(
            question_text=question.question_text,
            answer_text=answer.answer_text,
            interview_type=interview_type,
            difficulty=difficulty,
            context=context,
        )
        criteria = EvaluationCriteria.model_validate(provider_result)
    except TimeoutError as exc:
        raise EvaluationProviderUnavailableError from exc
    except ValueError as exc:
        raise EvaluationProviderResponseError from exc
    except (TypeError, KeyError) as exc:
        raise EvaluationProviderResponseError from exc

    evaluation = Evaluation(
        answer_id=answer.id,
        correctness_score=criteria.correctness_score,
        relevance_score=criteria.relevance_score,
        clarity_score=criteria.clarity_score,
        completeness_score=criteria.completeness_score,
        overall_score=calculate_overall_score(criteria),
        feedback=criteria.feedback or "See the structured analysis fields for details.",
        reasoning=criteria.reasoning,
        strengths=json.dumps(criteria.strengths),
        weaknesses=json.dumps(criteria.weaknesses),
        missing_concepts=json.dumps(criteria.missing_concepts),
        improvement_suggestions=json.dumps(criteria.improvement_suggestions),
        is_off_topic=criteria.is_off_topic,
        provider=provider.provider_name,
        model=getattr(provider, "model", None),
    )
    db.add(evaluation)
    db.flush()
    return evaluation
