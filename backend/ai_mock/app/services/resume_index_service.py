"""Resume index service.

Responsibility: build and query an in-memory keyword index over resume chunks.

Retrieval method: **TF-IDF-inspired keyword index** (BM25-lite variant).
- Term frequencies are computed per chunk.
- Inverse document frequency is approximated per chunk collection.
- Query tokens are matched against indexed tokens with stop-word filtering.

This is *not* vector retrieval and is *not* labelled as such anywhere in
this module.  The index is built entirely from resume chunk text and section
metadata -- no LLM or embedding model is involved.

Design contracts
----------------
- ``ResumeChunkIndex`` is the public indexing type.  Its interface is defined
  by ``ChunkIndexProtocol`` so callers can substitute an alternative
  implementation (e.g. a BM25 library or a vector store) in the future
  without changing the retrieval service.
- Build the index from ``ResumeChunk`` objects produced by
  ``resume_chunking_service.chunk_resume``.
- The index holds chunks in memory; it is not persisted to the database.
  For the current project scale (single resume per user, per request) this
  is appropriate.  A persistent store can be introduced later behind the same
  interface.

Security note
-------------
Chunk text is stored and matched as data.  Token extraction uses a simple
regex; no exec / eval / shell interpolation is performed.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.services.resume_chunking_service import ResumeChunk

# ---------------------------------------------------------------------------
# Stop-word list (English, minimal)
# ---------------------------------------------------------------------------

_STOP_WORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "been", "but", "by",
        "do", "for", "from", "has", "have", "he", "her", "him", "his",
        "how", "i", "if", "in", "is", "it", "its", "me", "my", "no",
        "not", "of", "on", "or", "our", "she", "so", "than", "that",
        "the", "their", "them", "then", "there", "they", "this", "to",
        "us", "was", "we", "were", "what", "when", "where", "who",
        "will", "with", "you", "your",
    }
)


def _tokenize(text: str) -> list[str]:
    """Lowercase, alphanumeric tokens with stop-word removal."""
    return [
        tok
        for tok in re.findall(r"[a-z0-9]+", text.lower())
        if tok not in _STOP_WORDS and len(tok) > 1
    ]


# ---------------------------------------------------------------------------
# Protocol (replaceability seam)
# ---------------------------------------------------------------------------


@runtime_checkable
class ChunkIndexProtocol(Protocol):
    """Minimal interface every chunk index must satisfy."""

    def build(self, chunks: list[ResumeChunk]) -> None:
        """Index the provided chunks, replacing any prior index contents."""

    def query(self, tokens: list[str], *, limit: int) -> list[tuple[float, ResumeChunk]]:
        """Return up to *limit* ``(score, chunk)`` pairs, descending by score."""


# ---------------------------------------------------------------------------
# TF-IDF keyword index
# ---------------------------------------------------------------------------


@dataclass
class ResumeChunkIndex:
    """In-memory TF-IDF keyword index over ``ResumeChunk`` objects.

    Usage::

        index = ResumeChunkIndex()
        index.build(chunks)            # chunks from resume_chunking_service
        results = index.query(tokens)  # tokens from resume_retrieval_service
    """

    _chunks: list[ResumeChunk] = field(default_factory=list, repr=False)
    # chunk_idx -> {token -> tf}
    _tf: list[dict[str, float]] = field(default_factory=list, repr=False)
    # token -> idf
    _idf: dict[str, float] = field(default_factory=dict, repr=False)
    # token -> set of chunk indices that contain it
    _posting: dict[str, set[int]] = field(default_factory=dict, repr=False)

    # ------------------------------------------------------------------
    # ChunkIndexProtocol
    # ------------------------------------------------------------------

    def build(self, chunks: list[ResumeChunk]) -> None:
        """Index *chunks* (replaces any previous index contents)."""
        self._chunks = list(chunks)
        self._tf = []
        self._idf = {}
        self._posting = {}

        n = len(chunks)
        if n == 0:
            return

        for idx, chunk in enumerate(chunks):
            tokens = _tokenize(chunk.text)
            token_count = len(tokens) or 1
            freq: dict[str, int] = {}
            for tok in tokens:
                freq[tok] = freq.get(tok, 0) + 1
            tf = {tok: count / token_count for tok, count in freq.items()}
            self._tf.append(tf)
            for tok in freq:
                self._posting.setdefault(tok, set()).add(idx)

        # IDF = log((1 + n) / (1 + df)) + 1  (smooth variant)
        for tok, doc_set in self._posting.items():
            df = len(doc_set)
            self._idf[tok] = math.log((1 + n) / (1 + df)) + 1

    def query(
        self, tokens: list[str], *, limit: int = 5
    ) -> list[tuple[float, ResumeChunk]]:
        """Score all indexed chunks against *tokens* and return the top *limit*.

        Returns an empty list when no chunks are indexed or no token matches.
        Scores are TF-IDF dot-products (non-negative floats).
        """
        if not self._chunks or not tokens:
            return []

        scores: dict[int, float] = {}
        for tok in tokens:
            if tok not in self._idf:
                continue
            idf = self._idf[tok]
            for idx in self._posting.get(tok, set()):
                tf = self._tf[idx].get(tok, 0.0)
                scores[idx] = scores.get(idx, 0.0) + tf * idf

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])
        return [(score, self._chunks[idx]) for idx, score in ranked[:limit]]

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    @property
    def chunk_count(self) -> int:
        """Number of chunks currently indexed."""
        return len(self._chunks)

    def is_empty(self) -> bool:
        """Return ``True`` when no chunks have been indexed."""
        return self.chunk_count == 0
