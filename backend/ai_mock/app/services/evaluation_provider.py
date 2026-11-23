import json
import re
import time
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

import httpx

from app.core.config import Settings, get_settings
from app.schemas.evaluation import EvaluationCriteria
from app.services.retrieval_service import RetrievedContext, retrieve_reference_material
from app.services.evaluation_context_service import EvaluationContext


class EvaluationProvider(Protocol):
    provider_name: str
    model: str | None
    is_ai_generated: bool

    def evaluate(
        self,
        *,
        question_text: str,
        answer_text: str,
        interview_type: str = "technical",
        difficulty: str = "intermediate",
        context: EvaluationContext | None = None,
    ) -> EvaluationCriteria:
        """Return validated, non-persisted analysis."""


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def _concept_covered(concept: str, answer_words: set[str]) -> bool:
    return any(
        word in answer_words
        or word.rstrip("s") in {item.rstrip("s") for item in answer_words}
        for word in _words(concept)
    )


def _score(value: float) -> Decimal:
    return Decimal(str(max(0, min(10, round(value, 2)))))


@dataclass(frozen=True)
class DeterministicMockEvaluationProvider:
    provider_name: str = "deterministic_mock"
    model: str | None = None
    is_ai_generated: bool = False

    def evaluate(
        self,
        *,
        question_text: str,
        answer_text: str,
        interview_type: str = "technical",
        difficulty: str = "intermediate",
        context: EvaluationContext | None = None,
    ) -> EvaluationCriteria:
        context = context or EvaluationContext(
            references=tuple(retrieve_reference_material(question_text, limit=3))
        )
        answer_words = _words(answer_text)
        word_count = len(answer_words)
        sentence_count = max(1, len(re.findall(r"[.!?]+", answer_text)))
        concepts = tuple(dict.fromkeys(
            concept
            for reference in context.references
            for concept in reference.key_concepts
        ))
        concept_hits = sum(
            1 for concept in concepts
            if _concept_covered(concept, answer_words)
        )
        structure_bonus = min(sentence_count * 0.35, 1.4)
        detail_bonus = min(word_count / 55, 2.0)
        correctness = _score(3.5 + min(concept_hits * 0.8, 3.5) + min(detail_bonus, 2.0))
        relevance = _score(3.5 + min(detail_bonus, 2.5) + (1.0 if word_count >= 20 else 0))
        clarity = _score(3.5 + structure_bonus + min(word_count / 90, 2.5))
        completeness = _score(2.5 + min(concept_hits * 0.9, 4.5) + min(detail_bonus, 2.5))
        off_topic = word_count > 0 and not context.references and word_count < 4
        feedback = (
            "Mock evaluation only — deterministic heuristic output, not a real AI judgment. "
            f"The answer contains {word_count} words and {sentence_count} sentence(s); "
            "correctness is estimated from reference concepts and answer detail, not exact wording."
        )
        return EvaluationCriteria(
            correctness_score=correctness,
            relevance_score=relevance,
            clarity_score=clarity,
            completeness_score=completeness,
            reasoning="Scores are based on deterministic answer length and lexical overlap heuristics.",
            strengths=["Answer submitted successfully"] if word_count else [],
            weaknesses=["Add specific reasoning, examples, and trade-offs for more depth."],
            missing_concepts=[
                concept for concept in concepts
                if not _concept_covered(concept, answer_words)
            ][:5],
            improvement_suggestions=["Explain the approach step by step.", "Include edge cases or trade-offs."],
            is_off_topic=off_topic,
            feedback=feedback,
        )


class GroqEvaluationProvider:
    provider_name = "groq"
    is_ai_generated = True

    def __init__(self, settings: Settings):
        if not settings.groq_api_key:
            raise RuntimeError("GROQ_API_KEY is required when evaluation_provider is groq")
        self.api_key = settings.groq_api_key
        self.model = settings.groq_model
        self.timeout = settings.groq_timeout_seconds
        self.max_retries = settings.groq_max_retries

    def evaluate(
        self,
        *,
        question_text: str,
        answer_text: str,
        interview_type: str = "technical",
        difficulty: str = "intermediate",
        context: EvaluationContext | None = None,
    ) -> EvaluationCriteria:
        context = context or EvaluationContext(
            references=tuple(retrieve_reference_material(question_text, limit=3))
        )
        context_text = self._format_context(context)
        system_prompt = (
            "Evaluate a text interview answer using only concise, evidence-based reasoning. "
            "Do not reveal chain-of-thought. Return JSON with keys: correctness_score, "
            "relevance_score, clarity_score, completeness_score (0 to 10), reasoning, "
            "strengths, weaknesses, missing_concepts, improvement_suggestions, is_off_topic, feedback. "
            "Scores must be numbers from 0 to 10 and lists must contain short strings."
        )
        user_prompt = (
            f"Question: {question_text}\nAnswer: {answer_text}\n"
            f"Interview type: {interview_type}; difficulty: {difficulty}\n"
            f"Retrieved technical reference context: {context_text or 'None'}\n"
            f"Company role requirements (relevance only, not correctness criteria): "
            f"{'; '.join(context.company_requirements) or 'None'}\n"
            f"Resume evidence (unverified candidate claims): "
            f"{json.dumps(list(context.resume_evidence), ensure_ascii=True) if context.resume_evidence else 'None'}"
        )
        payload = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
        }
        for attempt in range(self.max_retries + 1):
            try:
                response = httpx.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json=payload,
                    timeout=self.timeout,
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
                return EvaluationCriteria.model_validate(json.loads(content))
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt >= self.max_retries:
                    raise TimeoutError from exc
                time.sleep(0.25 * (attempt + 1))
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code in {408, 429} or exc.response.status_code >= 500:
                    if attempt < self.max_retries:
                        time.sleep(0.25 * (attempt + 1))
                        continue
                    raise TimeoutError("Groq evaluation service is temporarily unavailable") from exc
                raise ValueError("Groq returned an invalid evaluation response") from exc
            except (KeyError, IndexError, TypeError, ValueError) as exc:
                raise ValueError("Groq returned an invalid evaluation response") from exc
        raise TimeoutError

    @staticmethod
    def _format_context(context: EvaluationContext) -> str:
        return "\n".join(
            f"Topic: {reference.topic}\nReference: {reference.reference_answer}\n"
            f"Key concepts: {', '.join(reference.key_concepts)}\nRubric: {reference.rubric}"
            for reference in context.references
        )


def get_evaluation_provider(settings: Settings | None = None) -> EvaluationProvider:
    current_settings = settings or get_settings()
    if current_settings.evaluation_provider.lower() == "groq":
        return GroqEvaluationProvider(current_settings)
    if current_settings.evaluation_provider.lower() == "mock":
        return DeterministicMockEvaluationProvider()
    raise RuntimeError("EVALUATION_PROVIDER must be either mock or groq")


evaluation_provider = get_evaluation_provider()
