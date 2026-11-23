from decimal import Decimal

from app.schemas.evaluation import EvaluationCriteria
from app.services.evaluation_context_service import EvaluationContext
from app.services.evaluation_provider import DeterministicMockEvaluationProvider
from app.services.evaluation_service import EVALUATION_WEIGHTS, calculate_overall_score
from app.services.retrieval_service import RetrievedContext


def reference_context() -> EvaluationContext:
    return EvaluationContext(
        references=(
            RetrievedContext(
                topic="databases",
                reference_answer="Discuss indexes and transactions.",
                key_concepts=("indexes", "transactions", "trade-offs"),
                rubric="Explain semantics and trade-offs.",
                score=2,
            ),
        )
    )


def test_overall_score_uses_centralized_provisional_weights():
    criteria = EvaluationCriteria(
        correctness_score=Decimal("10"),
        relevance_score=Decimal("8"),
        completeness_score=Decimal("6"),
        clarity_score=Decimal("4"),
    )

    assert calculate_overall_score(criteria) == Decimal("7.60")
    assert sum(EVALUATION_WEIGHTS.values()) == Decimal("1.00")


def test_deterministic_provider_accepts_valid_alternative_explanation():
    result = DeterministicMockEvaluationProvider().evaluate(
        question_text="How would you design a database transaction?",
        answer_text=(
            "I would use a transaction to keep related writes atomic, choose indexes for "
            "the access pattern, and document the consistency and performance trade-offs."
        ),
        context=reference_context(),
    )

    assert Decimal("0") <= result.correctness_score <= Decimal("10")
    assert result.is_off_topic is False
    assert "transactions" not in result.missing_concepts


def test_deterministic_provider_handles_empty_and_off_topic_answers():
    provider = DeterministicMockEvaluationProvider()
    empty = provider.evaluate(question_text="Explain SQL indexes", answer_text="")
    off_topic = provider.evaluate(question_text="Explain an algorithm", answer_text="Weather today.")

    assert empty.correctness_score >= Decimal("0")
    assert off_topic.is_off_topic is False
    assert off_topic.feedback
