"""RAG-grounded interview question generation with Pydantic validation, deduplication, and bank fallback."""

from __future__ import annotations

import logging
import math
from typing import Any, Iterable, Literal, Optional

from pydantic import BaseModel, Field, ValidationError, field_validator

from app import llm, rag
from app.llm import LLMError

logger = logging.getLogger(__name__)

PROMPT_VERSION = "qgen-v1"
DUPLICATE_SIMILARITY_THRESHOLD = 0.85
MAX_GENERATION_RETRIES = 2

# Exact prompt template required for question generation
SYSTEM_PROMPT = """You are a technical interviewer conducting a mock campus-placement interview.
Generate exactly ONE interview question for the configuration given by the user.
Rules:
1. Ground the question in the REFERENCE CONTEXT when it is provided.
2. Match the requested ROLE, EXPERIENCE LEVEL, INTERVIEW TYPE and DIFFICULTY.
3. Do not repeat, or rephrase, any question listed under PREVIOUS QUESTIONS.
4. Ask one clear question of at most 60 words. Do not include the answer or hints.
5. Return ONLY a valid JSON object that follows the schema below. No preamble, no explanation and no markdown code fences.
Schema: {"question": "string (max 60 words)", "topic": "string", "type": "technical | behavioural", "difficulty": "easy | medium | hard", "expected_concepts": ["3 to 6 key concepts a good answer should cover"]}"""

_DEFAULT_TECHNICAL_TOPICS = ["dsa", "dbms", "os", "cn", "oop", "web", "aiml"]

_ROLE_TOPIC_MAP: list[tuple[tuple[str, ...], list[str]]] = [
    (("ml", "ai", "data", "machine learning", "nlp"), ["aiml", "dsa", "dbms", "oop", "os"]),
    (("frontend", "front-end", "react", "ui", "web"), ["web", "dsa", "oop", "cn", "dbms"]),
    (("backend", "back-end", "api", "full stack", "fullstack"), ["dbms", "web", "dsa", "cn", "os", "oop"]),
    (("systems", "embedded", "devops", "cloud", "sre", "network"), ["os", "cn", "dsa", "dbms", "oop"]),
    (("sde", "software", "developer", "engineer"), ["dsa", "dbms", "oop", "os", "cn", "web"]),
]

_SKILL_TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "dsa": ("dsa", "algorithm", "data structure", "tree", "graph", "dp", "leetcode"),
    "dbms": ("sql", "postgres", "mysql", "dbms", "database", "mongo", "redis", "index"),
    "os": ("linux", "operating system", "os", "thread", "concurrency", "process", "kernel"),
    "cn": ("network", "tcp", "http", "dns", "tls", "socket", "cn"),
    "oop": ("oop", "java", "c++", "design pattern", "solid", "object-oriented"),
    "web": ("react", "web", "fastapi", "node", "express", "rest", "html", "css", "javascript", "typescript"),
    "aiml": ("ai", "ml", "machine learning", "deep learning", "rag", "llm", "nlp", "pytorch", "transformer"),
}


class GeneratedQuestionPayload(BaseModel):
    """Strict Pydantic v2 validator for LLM-generated questions."""

    question: str = Field(..., min_length=5)
    topic: str = Field(..., min_length=1, max_length=120)
    type: Literal["technical", "behavioural"]
    difficulty: Literal["easy", "medium", "hard"]
    expected_concepts: list[str]

    @field_validator("question")
    @classmethod
    def _validate_question_length(cls, value: str) -> str:
        cleaned = " ".join(value.strip().split())
        if not cleaned:
            raise ValueError("question must not be empty")
        word_count = len(cleaned.split())
        if word_count > 60:
            raise ValueError(f"question exceeds 60 words ({word_count} words)")
        return cleaned

    @field_validator("topic")
    @classmethod
    def _validate_topic(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("topic must not be empty")
        return cleaned

    @field_validator("expected_concepts")
    @classmethod
    def _validate_expected_concepts(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if isinstance(item, str) and item.strip()]
        if not (3 <= len(cleaned) <= 6):
            raise ValueError(f"expected_concepts must contain 3 to 6 items (got {len(cleaned)})")
        return cleaned


def _extract_previous_texts(previous_questions: Iterable[Any]) -> list[str]:
    texts: list[str] = []
    for item in previous_questions:
        if isinstance(item, str):
            text = item.strip()
        else:
            text = str(getattr(item, "text", getattr(item, "question", ""))).strip()
        if text:
            texts.append(text)
    return texts


def _extract_session_skills(session: Any) -> list[str]:
    direct_skills = getattr(session, "skills", None)
    if isinstance(direct_skills, list) and direct_skills:
        return [str(s).strip() for s in direct_skills if str(s).strip()]

    user = getattr(session, "user", None)
    profile = getattr(user, "profile", None) if user is not None else None
    profile_skills = getattr(profile, "skills", None) if profile is not None else None
    if isinstance(profile_skills, list):
        return [str(s).strip() for s in profile_skills if str(s).strip()]
    return []


def select_topic_for_question(
    role: str,
    skills: list[str],
    interview_type: str,
    question_number: int,
) -> str:
    """Choose a relevant KB topic and rotate across topics for technical interviews."""
    if interview_type == "behavioural":
        return "hr"

    role_lower = role.lower()
    ordered_topics: list[str] = []

    # 1. Prioritize topics explicitly matched in candidate skills
    skills_blob = " ".join(skills).lower()
    if skills_blob:
        for topic_slug, keywords in _SKILL_TOPIC_KEYWORDS.items():
            if any(kw in skills_blob for kw in keywords) and topic_slug not in ordered_topics:
                ordered_topics.append(topic_slug)

    # 2. Add role-relevant topic rotation
    for role_keywords, topics in _ROLE_TOPIC_MAP:
        if any(kw in role_lower for kw in role_keywords):
            for t in topics:
                if t not in ordered_topics:
                    ordered_topics.append(t)
            break

    # 3. Fill with default technical topics so rotation always has variety
    for t in _DEFAULT_TECHNICAL_TOPICS:
        if t not in ordered_topics:
            ordered_topics.append(t)

    idx = max(0, question_number - 1) % len(ordered_topics)
    return ordered_topics[idx]


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _is_duplicate_question(
    candidate_question: str,
    previous_texts: list[str],
    previous_embeddings: list[list[float]],
    threshold: float = DUPLICATE_SIMILARITY_THRESHOLD,
) -> tuple[bool, float]:
    """Return (is_duplicate, max_cosine_similarity) against previously asked questions."""
    if not previous_texts:
        return False, 0.0

    norm_candidate = " ".join(candidate_question.lower().split())
    for prev in previous_texts:
        if norm_candidate == " ".join(prev.lower().split()):
            return True, 1.0

    candidate_vec = rag.embed(candidate_question)
    max_sim = 0.0
    for prev_vec in previous_embeddings:
        sim = _cosine_similarity(candidate_vec, prev_vec)
        if sim > max_sim:
            max_sim = sim
    return max_sim >= threshold, max_sim


def _build_user_prompt(
    *,
    role: str,
    experience_level: str,
    interview_type: str,
    difficulty: str,
    skills: list[str],
    question_number: int,
    total_questions: int,
    reference_chunks: list[dict[str, Any]],
    previous_texts: list[str],
) -> str:
    skills_str = ", ".join(skills) if skills else "General computer science fundamentals"

    if reference_chunks:
        context_lines = [
            f"[{idx}] (topic={chunk.get('topic', '')}, difficulty={chunk.get('difficulty', '')})\n{chunk.get('text', '')}"
            for idx, chunk in enumerate(reference_chunks, start=1)
        ]
        reference_block = "\n\n".join(context_lines)
    else:
        reference_block = "None"

    if previous_texts:
        previous_block = "\n".join(f"{idx}. {q}" for idx, q in enumerate(previous_texts, start=1))
    else:
        previous_block = "None"

    return (
        f"ROLE: {role}\n"
        f"EXPERIENCE LEVEL: {experience_level}\n"
        f"INTERVIEW TYPE: {interview_type}\n"
        f"DIFFICULTY: {difficulty}\n"
        f"SKILLS: {skills_str}\n"
        f"QUESTION NUMBER: {question_number} of {total_questions}\n\n"
        f"REFERENCE CONTEXT:\n{reference_block}\n\n"
        f"PREVIOUS QUESTIONS:\n{previous_block}"
    )


def generate_question(
    session: Any,
    previous_questions: Iterable[Any],
    *,
    k: int = 4,
) -> dict[str, Any]:
    """Generate one RAG-grounded, validated, deduplicated interview question for a session.

    Retries up to 2 times on LLM/schema/duplicate failures, then falls back to
    `rag.sample_bank_question`.
    """
    prev_texts = _extract_previous_texts(previous_questions)
    question_number = len(prev_texts) + 1
    total_questions = int(getattr(session, "total_questions", 5))
    role = str(getattr(session, "role", "Software Engineer"))
    experience_level = str(getattr(session, "experience_level", "Fresher"))
    interview_type = str(getattr(session, "interview_type", "technical")).lower()
    difficulty = str(getattr(session, "difficulty", "medium")).lower()
    skills = _extract_session_skills(session)

    selected_topic = select_topic_for_question(
        role=role,
        skills=skills,
        interview_type=interview_type,
        question_number=question_number,
    )

    retrieval_query = " ".join(
        part
        for part in [
            role,
            " ".join(skills),
            interview_type,
            difficulty,
            selected_topic,
        ]
        if part
    )

    reference_chunks: list[dict[str, Any]] = []
    try:
        reference_chunks = rag.retrieve(
            retrieval_query,
            type=interview_type,
            difficulty=difficulty,
            topic=selected_topic,
            k=k,
        )
        if not reference_chunks:
            reference_chunks = rag.retrieve(
                retrieval_query,
                type=interview_type,
                topic=selected_topic,
                k=k,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "RAG retrieval unavailable for session=%s prompt_version=%s: %s",
            getattr(session, "id", None),
            PROMPT_VERSION,
            exc,
        )

    user_prompt = _build_user_prompt(
        role=role,
        experience_level=experience_level,
        interview_type=interview_type,
        difficulty=difficulty,
        skills=skills,
        question_number=question_number,
        total_questions=total_questions,
        reference_chunks=reference_chunks,
        previous_texts=prev_texts,
    )

    # Pre-embed previous questions once if needed for cosine duplicate detection
    previous_embeddings: Optional[list[list[float]]] = None

    for attempt in range(1, MAX_GENERATION_RETRIES + 2):
        logger.info(
            "Generating question prompt_version=%s session_id=%s q=%d/%d topic=%s attempt=%d",
            PROMPT_VERSION,
            getattr(session, "id", None),
            question_number,
            total_questions,
            selected_topic,
            attempt,
        )
        try:
            raw_payload = llm.call_llm_json(
                SYSTEM_PROMPT,
                user_prompt,
                temperature=0.3 if attempt == 1 else 0.6,
            )
            validated = GeneratedQuestionPayload.model_validate(raw_payload)
        except (LLMError, ValidationError) as exc:
            logger.warning(
                "Question generation failed prompt_version=%s attempt=%d: %s",
                PROMPT_VERSION,
                attempt,
                exc,
            )
            continue

        if validated.type != interview_type:
            logger.warning(
                "Question type mismatch prompt_version=%s attempt=%d: expected=%s got=%s",
                PROMPT_VERSION,
                attempt,
                interview_type,
                validated.type,
            )
            continue

        if prev_texts:
            if previous_embeddings is None:
                previous_embeddings = [rag.embed(q) for q in prev_texts]
            is_dup, max_sim = _is_duplicate_question(
                validated.question,
                prev_texts,
                previous_embeddings,
                threshold=DUPLICATE_SIMILARITY_THRESHOLD,
            )
            if is_dup:
                logger.warning(
                    "Duplicate question rejected prompt_version=%s attempt=%d similarity=%.3f",
                    PROMPT_VERSION,
                    attempt,
                    max_sim,
                )
                continue

        return validated.model_dump()

    logger.warning(
        "Falling back to CSV question bank prompt_version=%s session_id=%s topic=%s",
        PROMPT_VERSION,
        getattr(session, "id", None),
        selected_topic,
    )
    fallback = rag.sample_bank_question(
        type=interview_type,
        difficulty=difficulty,
        exclude_questions=prev_texts,
        topic=selected_topic,
    )
    return {
        "question": fallback["question"],
        "topic": fallback["topic"],
        "type": fallback["type"],
        "difficulty": fallback["difficulty"],
        "expected_concepts": list(fallback["expected_concepts"]),
    }
