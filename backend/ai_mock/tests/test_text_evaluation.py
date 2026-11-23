from decimal import Decimal

import httpx
import pytest

from app.core.config import Settings
from app.schemas.evaluation import EvaluationCriteria
from app.services.evaluation_provider import GroqEvaluationProvider, DeterministicMockEvaluationProvider
from app.services.evaluation_service import calculate_overall_score
from app.services.retrieval_service import retrieve_reference_material


def test_retrieval_returns_relevant_context_and_skips_unrelated_questions():
    database_context = retrieve_reference_material("How do indexes improve a database query?")
    unrelated_context = retrieve_reference_material("What is my favorite color?")

    assert database_context
    assert database_context[0].topic == "databases"
    assert database_context[0].key_concepts
    assert unrelated_context == []


def test_mock_evaluation_returns_structured_bounded_analysis():
    result = DeterministicMockEvaluationProvider().evaluate(
        question_text="Explain database indexes and query performance.",
        answer_text="Indexes speed up lookup by reducing scanned rows, but they add write cost and storage.",
    )

    assert isinstance(result, EvaluationCriteria)
    assert Decimal("0") <= result.correctness_score <= Decimal("10")
    assert Decimal("0") <= result.relevance_score <= Decimal("10")
    assert result.improvement_suggestions


def test_overall_score_uses_documented_mvp_weights():
    criteria = EvaluationCriteria(
        correctness_score=Decimal("10"),
        relevance_score=Decimal("8"),
        clarity_score=Decimal("6"),
        completeness_score=Decimal("4"),
    )

    assert calculate_overall_score(criteria) == Decimal("7.40")


def test_groq_provider_requires_api_key():
    settings = Settings(
        database_url="postgresql://localhost/test",
        jwt_secret_key="test",
        evaluation_provider="groq",
        groq_api_key=None,
    )

    with pytest.raises(RuntimeError, match="GROQ_API_KEY"):
        GroqEvaluationProvider(settings)


def test_groq_provider_parses_structured_response(monkeypatch):
    settings = Settings(
        database_url="postgresql://localhost/test",
        jwt_secret_key="test",
        evaluation_provider="groq",
        groq_api_key="test-key",
    )
    provider = GroqEvaluationProvider(settings)

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [{
                    "message": {
                        "content": '{"correctness_score": 8, "relevance_score": 7, '
                        '"clarity_score": 9, "completeness_score": 6, '
                        '"reasoning": "Evidence-based.", "strengths": ["Clear"], '
                        '"weaknesses": [], "missing_concepts": ["Testing"], '
                        '"improvement_suggestions": ["Add tests"], '
                        '"is_off_topic": false, "feedback": "Good answer."}',
                    },
                }],
            }

    monkeypatch.setattr(httpx, "post", lambda *args, **kwargs: Response())
    result = provider.evaluate(
        question_text="Explain an API.",
        answer_text="An API defines a contract between clients and services.",
    )

    assert result.correctness_score == Decimal("8")
    assert result.missing_concepts == ["Testing"]
