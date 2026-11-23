"""Resume chunking service.

Responsibility: split a plain-text resume into overlapping, annotated chunks.

This module is intentionally independent of:
- resume_service  (upload / extraction)
- resume_index_service (indexing)
- resume_retrieval_service (retrieval)

Chunking strategy
-----------------
1. Attempt to detect well-known resume section headers using a curated
   regex list (Skills, Experience, Education, Projects, Certifications, ...).
2. When headers are found the text is split into named sections first;
   each section is then subdivided into overlapping word-window chunks.
3. When no headers are found the full text is chunked as a single
   "general" section using the same sliding-window logic.
4. Every chunk carries a ``ChunkSource`` that records the resume id,
   section name, and character offsets in the original extracted text.

Security note
-------------
The extracted resume text is treated as *data*, not instructions.
No part of it is interpolated into f-strings that reach an LLM prompt
from within this module.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import replace

# ---------------------------------------------------------------------------
# Known section labels
# ---------------------------------------------------------------------------

KNOWN_SECTIONS: tuple[str, ...] = (
    "skills",
    "technical skills",
    "core skills",
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "education",
    "academic background",
    "projects",
    "personal projects",
    "side projects",
    "certifications",
    "certificates",
    "awards",
    "publications",
    "summary",
    "objective",
    "profile",
    "about",
    "languages",
    "interests",
    "volunteer",
    "volunteering",
)

# A line is a section header when its entire visible content matches a known
# label, possibly surrounded by whitespace, dashes, colons, or hash marks.
_SECTION_HEADER_RE = re.compile(
    r"^\s*(?:[-=#+*\u2013\u2014\u2022]+\s*)?("
    + "|".join(re.escape(s) for s in KNOWN_SECTIONS)
    + r")[\s:=\-\u2013\u2014]*$",
    re.IGNORECASE | re.MULTILINE,
)

# Default chunking parameters (word-count based)
DEFAULT_CHUNK_WORDS: int = 120
DEFAULT_OVERLAP_WORDS: int = 30


# ---------------------------------------------------------------------------
# Public data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ChunkSource:
    """Provenance record for one resume chunk."""

    resume_id: int
    """Database id of the parent Resume row."""

    section: str
    """Detected section name (lower-case) or ``'general'`` when unknown."""

    char_start: int
    """Inclusive start offset of this chunk in the original extracted text."""

    char_end: int
    """Exclusive end offset of this chunk in the original extracted text."""


@dataclass(frozen=True)
class ResumeChunk:
    """A single text window extracted from a resume."""

    text: str
    """The chunk text (word-boundary aligned)."""

    source: ChunkSource
    """Origin information for the chunk."""

    section_label: str
    """Human-readable section label (mirrors ``source.section``)."""

    chunk_index: int
    """Zero-based position of this chunk within its parent section."""

    word_count: int
    """Number of whitespace-delimited tokens in ``text``."""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _word_windows(
    section_text: str,
    *,
    chunk_words: int,
    overlap_words: int,
    base_offset: int,
    resume_id: int,
    section: str,
) -> list[ResumeChunk]:
    """Slice *section_text* into overlapping word windows.

    Parameters
    ----------
    section_text:
        Text belonging to one detected section (already stripped).
    chunk_words:
        Maximum number of words per chunk.
    overlap_words:
        Words shared between consecutive chunks.
    base_offset:
        Character offset of *section_text* inside the full extracted text.
    resume_id:
        Parent Resume database id.
    section:
        Normalised section name.
    """
    words = section_text.split()
    if not words:
        return []

    step = max(1, chunk_words - overlap_words)
    chunks: list[ResumeChunk] = []
    # Running character cursor used to compute offsets without re-scanning the
    # whole string from the start each iteration.
    cursor: int = 0

    for chunk_index, word_start in enumerate(range(0, len(words), step)):
        window = words[word_start : word_start + chunk_words]
        chunk_text = " ".join(window)

        # Find the first word of this window inside the remaining section text.
        pattern = re.escape(window[0])
        m = re.search(pattern, section_text[cursor:])
        if m:
            char_start = base_offset + cursor + m.start()
        else:
            # Fallback: use the cursor position as an approximation.
            char_start = base_offset + cursor

        char_end = char_start + len(chunk_text)

        chunks.append(
            ResumeChunk(
                text=chunk_text,
                source=ChunkSource(
                    resume_id=resume_id,
                    section=section.lower(),
                    char_start=char_start,
                    char_end=char_end,
                ),
                section_label=section.lower(),
                chunk_index=chunk_index,
                word_count=len(window),
            )
        )

        # Advance the cursor to just after the start of this window's first
        # word so the next iteration searches forward only.
        if m:
            cursor = cursor + m.start() + len(window[0])

    return chunks


def _detect_sections(text: str) -> list[tuple[str, int, int]]:
    """Return ``(section_name, content_start, content_end)`` tuples.

    Character offsets are relative to *text*.  When no headers are detected,
    returns a single ``("general", 0, len(text))`` entry.
    """
    matches = list(_SECTION_HEADER_RE.finditer(text))
    if not matches:
        return [("general", 0, len(text))]

    sections: list[tuple[str, int, int]] = []

    # Preamble before the first header.
    if matches[0].start() > 0:
        preamble = text[: matches[0].start()].strip()
        if preamble:
            sections.append(("summary", 0, matches[0].start()))

    for idx, match in enumerate(matches):
        name = match.group(1).lower()
        content_start = match.end()
        content_end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        sections.append((name, content_start, content_end))

    return sections


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def chunk_resume(
    extracted_text: str,
    *,
    resume_id: int,
    chunk_words: int = DEFAULT_CHUNK_WORDS,
    overlap_words: int = DEFAULT_OVERLAP_WORDS,
) -> list[ResumeChunk]:
    """Split *extracted_text* into annotated, overlapping chunks.

    Parameters
    ----------
    extracted_text:
        Raw text from ``resume_service.store_and_extract_resume``.
        Treated as untrusted data -- never interpreted as instructions.
    resume_id:
        The ``id`` of the persisted ``Resume`` row.
    chunk_words:
        Target word count per chunk.
    overlap_words:
        Words shared between consecutive chunks in the same section.
        Must be less than *chunk_words*.

    Returns
    -------
    list[ResumeChunk]
        Ordered chunks.  Returns ``[]`` for blank or whitespace-only input
        so callers can handle sparse resumes gracefully.

    Raises
    ------
    ValueError
        If *overlap_words* >= *chunk_words*.
    """
    if overlap_words >= chunk_words:
        raise ValueError(
            f"overlap_words ({overlap_words}) must be less than "
            f"chunk_words ({chunk_words})"
        )

    leading_whitespace = len(extracted_text) - len(extracted_text.lstrip())
    text = extracted_text.strip()
    if not text:
        return []

    sections = _detect_sections(text)
    all_chunks: list[ResumeChunk] = []
    section_counters: dict[str, int] = {}

    for section_name, start, end in sections:
        raw_section_text = text[start:end]
        section_leading_whitespace = len(raw_section_text) - len(raw_section_text.lstrip())
        section_text = raw_section_text.strip()
        if not section_text:
            continue
        section_chunks = _word_windows(
            section_text,
            chunk_words=chunk_words,
            overlap_words=overlap_words,
            base_offset=leading_whitespace + start + section_leading_whitespace,
            resume_id=resume_id,
            section=section_name,
        )
        section_key = section_name.lower()
        next_index = section_counters.get(section_key, 0)
        all_chunks.extend(
            replace(chunk, chunk_index=next_index + chunk.chunk_index)
            for chunk in section_chunks
        )
        section_counters[section_key] = next_index + len(section_chunks)

    return all_chunks


def section_labels(chunks: list[ResumeChunk]) -> list[str]:
    """Return unique section labels present in *chunks*, preserving order."""
    seen: list[str] = []
    for chunk in chunks:
        if chunk.section_label not in seen:
            seen.append(chunk.section_label)
    return seen
