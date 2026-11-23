"""Resume retrieval service.

Responsibility: retrieve ranked resume chunks relevant to a question-generation
context (role, interview type, difficulty, question text).

Retrieval method: **TF-IDF keyword matching** via ``ResumeChunkIndex``.
- Query tokens are expanded with role and interview-type synonyms.
- Section-affinity bonuses are applied (e.g. the "skills" section is boosted
  for technical interviews; "experience" for behavioural ones).
- Results carry full source attribution (resume id, section, char offsets).

This module does **not** use embeddings, a vector database, or a language
model.  It is labelled "keyword retrieval" throughout.

Design contracts
----------------
- ``retrieve_resume_chunks`` is the single public entry point.
- It accepts a pre-built ``ChunkIndexProtocol`` implementation, making it
  possible to swap in an alternative index (vector store, BM25 library) by
  passing a different object -- the retrieval logic and caller code do not
  change.
- Returns ``[]`` gracefully when the index is empty or when no chunks score
  above the minimum relevance threshold.

Security note
-------------
Role, interview_type, difficulty, and question_text are used *only* to
construct the query token list.  They are never concatenated into system
prompts or treated as executable code.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.resume_chunking_service import ChunkSource, ResumeChunk
from app.services.resume_index_service import ChunkIndexProtocol, _tokenize

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Minimum TF-IDF score for a chunk to appear in results.
MIN_RELEVANCE_SCORE: float = 0.01

# Section affinity: interview_type -> {section_label -> multiplier}
_SECTION_AFFINITY: dict[str, dict[str, float]] = {
    "technical": {
        "skills": 1.5,
        "technical skills": 1.5,
        "core skills": 1.4,
        "projects": 1.3,
        "certifications": 1.2,
        "certificates": 1.2,
        "experience": 1.1,
        "work experience": 1.1,
        "professional experience": 1.1,
    },
    "behavioral": {
        "experience": 1.5,
        "work experience": 1.5,
        "professional experience": 1.5,
        "projects": 1.3,
        "summary": 1.2,
        "profile": 1.2,
        "about": 1.2,
        "volunteer": 1.1,
        "volunteering": 1.1,
    },
    "mixed": {
        "skills": 1.3,
        "experience": 1.3,
        "projects": 1.3,
        "certifications": 1.1,
        "summary": 1.1,
    },
}

# Difficulty -> bonus tokens added to the query.
_DIFFICULTY_TOKENS: dict[str, list[str]] = {
    "junior": ["basic", "fundamental", "entry"],
    "intermediate": ["experience", "design", "problem"],
    "senior": ["architecture", "leadership", "system", "scalability"],
    "expert": ["principal", "staff", "architect", "strategy"],
}


# ---------------------------------------------------------------------------
# Public data class
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RankedChunk:
    """A retrieved resume chunk with relevance metadata."""

    text: str
    """Chunk text (data only -- never interpreted as an instruction)."""

    source: ChunkSource
    """Full provenance: resume_id, section, char_start, char_end."""

    section_label: str
    """Detected resume section (e.g. ``'skills'``, ``'experience'``)."""

    relevance_score: float
    """Non-negative TF-IDF score after section-affinity adjustment."""

    retrieval_method: str = "tfidf_keyword"
    """Honest label describing the retrieval mechanism used."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_query_tokens(
    *,
    role: str,
    interview_type: str,
    difficulty: str,
    question_text: str,
) -> list[str]:
    """Combine context fields into a deduplicated query token list.

    All inputs are lowercased and tokenized; no input is interpreted as an
    instruction or concatenated into a prompt.
    """
    # Role and question text provide the lexical evidence. Interview type is
    # applied through section affinity and difficulty is applied as a small
    # reranking signal below; indexing generic context words directly would
    # make unrelated queries match common resume terms such as "experience".
    tokens = _tokenize(f"{role} {question_text}")

    # Deduplicate while preserving order.
    seen: set[str] = set()
    result: list[str] = []
    for tok in tokens:
        if tok not in seen:
            seen.add(tok)
            result.append(tok)
    return result


def _apply_section_affinity(
    score: float,
    section_label: str,
    interview_type: str,
) -> float:
    """Multiply *score* by the section affinity for the given interview type."""
    affinity_map = _SECTION_AFFINITY.get(interview_type.lower(), {})
    multiplier = affinity_map.get(section_label.lower(), 1.0)
    return score * multiplier


def _apply_difficulty_affinity(
    score: float,
    chunk: ResumeChunk,
    difficulty: str,
) -> float:
    difficulty_tokens = set(_DIFFICULTY_TOKENS.get(difficulty.lower(), []))
    if not difficulty_tokens:
        return score
    chunk_tokens = set(_tokenize(chunk.text))
    if difficulty_tokens & chunk_tokens:
        return score * 1.05
    return score


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def retrieve_resume_chunks(
    index: ChunkIndexProtocol,
    *,
    role: str,
    interview_type: str,
    difficulty: str,
    question_text: str,
    limit: int = 5,
    min_score: float = MIN_RELEVANCE_SCORE,
) -> list[RankedChunk]:
    """Retrieve and rank resume chunks relevant to the question context.

    Parameters
    ----------
    index:
        A built ``ChunkIndexProtocol`` instance (e.g. ``ResumeChunkIndex``).
        The index is read-only; this function does not modify it.
    role:
        The job role for the interview session (e.g. ``"backend engineer"``).
    interview_type:
        One of ``"technical"``, ``"behavioral"``, or ``"mixed"``.
    difficulty:
        One of ``"junior"``, ``"intermediate"``, ``"senior"``, ``"expert"``.
    question_text:
        The current question text used to expand the query.
    limit:
        Maximum number of chunks to return.  Defaults to ``5``.
    min_score:
        Chunks with an adjusted score below this threshold are excluded.
        Defaults to ``MIN_RELEVANCE_SCORE``.

    Returns
    -------
    list[RankedChunk]
        Chunks ranked by adjusted TF-IDF score, descending.  Returns ``[]``
        when the index is empty or no chunk meets the minimum score --
        callers must handle this gracefully without inventing content.

    Notes
    -----
    - This function performs **keyword retrieval**, not vector retrieval.
    - It never invents skills, projects, employment, or qualifications.
    - Resume text is treated as untrusted data throughout.
    """
    if limit < 1:
        return []

    query_tokens = _build_query_tokens(
        role=role,
        interview_type=interview_type,
        difficulty=difficulty,
        question_text=question_text,
    )

    if not query_tokens:
        return []

    raw_results = index.query(query_tokens, limit=limit * 2)

    ranked: list[RankedChunk] = []
    for raw_score, chunk in raw_results:
        adjusted_score = _apply_section_affinity(
            raw_score, chunk.section_label, interview_type
        )
        adjusted_score = _apply_difficulty_affinity(
            adjusted_score,
            chunk,
            difficulty,
        )
        if adjusted_score >= min_score:
            ranked.append(
                RankedChunk(
                    text=chunk.text,
                    source=chunk.source,
                    section_label=chunk.section_label,
                    relevance_score=round(adjusted_score, 6),
                )
            )

    # Re-sort after affinity adjustment (may change relative order).
    ranked.sort(key=lambda r: -r.relevance_score)
    return ranked[:limit]


def build_index_from_text(
    extracted_text: str,
    *,
    resume_id: int,
    chunk_words: int = 120,
    overlap_words: int = 30,
) -> "ResumeChunkIndex":  # noqa: F821 -- avoid circular import at module level
    """Convenience helper: chunk *extracted_text* and build an index.

    Imports are deferred to avoid circular dependencies.

    Parameters
    ----------
    extracted_text:
        Raw extracted resume text from ``resume_service``.
    resume_id:
        The ``Resume.id`` this text belongs to.
    chunk_words:
        Forwarded to ``chunk_resume``.
    overlap_words:
        Forwarded to ``chunk_resume``.

    Returns
    -------
    ResumeChunkIndex
        A built index ready to pass to ``retrieve_resume_chunks``.
        If *extracted_text* is empty, the index will be empty and
        ``retrieve_resume_chunks`` will return ``[]``.
    """
    from app.services.resume_chunking_service import chunk_resume
    from app.services.resume_index_service import ResumeChunkIndex

    chunks = chunk_resume(
        extracted_text,
        resume_id=resume_id,
        chunk_words=chunk_words,
        overlap_words=overlap_words,
    )
    index = ResumeChunkIndex()
    index.build(chunks)
    return index
