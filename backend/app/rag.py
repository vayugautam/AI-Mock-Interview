"""Knowledge base CSV loader, sentence-transformer embeddings, and Qdrant RAG retrieval."""

from __future__ import annotations

import csv
import hashlib
import random
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Optional

from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from sentence_transformers import SentenceTransformer

from app.config import settings

EMBEDDING_MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384
KB_COLLECTION_NAME = "kb"
DEFAULT_KB_DIR = Path(__file__).resolve().parents[1] / "data" / "kb"


def build_chunk_text(
    question: str,
    reference_answer: str,
    expected_concepts: list[str],
) -> str:
    """Format a single KB row into a retrieval-ready text chunk."""
    concepts_str = ", ".join(expected_concepts)
    return (
        f"Question: {question.strip()}\n"
        f"Reference Answer: {reference_answer.strip()}\n"
        f"Expected Concepts: {concepts_str}"
    )


def stable_point_id(topic: str, question: str) -> str:
    """Generate a deterministic UUID string from topic + normalized question for idempotent upserts."""
    normalized = f"{topic.strip().lower()}::{question.strip().lower()}"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]
    return str(uuid.UUID(digest))


def load_kb_rows(kb_dir: Optional[Path] = None) -> list[dict[str, Any]]:
    """Read all `<topic>.csv` files from `backend/data/kb/` into normalized row dicts."""
    directory = kb_dir or DEFAULT_KB_DIR
    if not directory.is_dir():
        raise FileNotFoundError(f"Knowledge base directory not found: {directory}")

    rows: list[dict[str, Any]] = []
    for csv_path in sorted(directory.glob("*.csv")):
        with csv_path.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            for row_idx, raw in enumerate(reader, start=2):
                question = (raw.get("question") or "").strip()
                reference_answer = (raw.get("reference_answer") or "").strip()
                q_type = (raw.get("type") or "").strip().lower()
                difficulty = (raw.get("difficulty") or "").strip().lower()
                topic = (raw.get("topic") or csv_path.stem).strip().lower()
                concepts = [
                    c.strip()
                    for c in (raw.get("expected_concepts") or "").split("|")
                    if c.strip()
                ]
                if not question or not reference_answer:
                    raise ValueError(
                        f"Missing question or reference_answer in {csv_path.name} line {row_idx}"
                    )
                rows.append(
                    {
                        "id": stable_point_id(topic, question),
                        "question": question,
                        "reference_answer": reference_answer,
                        "type": q_type,
                        "difficulty": difficulty,
                        "topic": topic,
                        "expected_concepts": concepts,
                        "text": build_chunk_text(question, reference_answer, concepts),
                        "source_file": csv_path.name,
                    }
                )
    return rows


@lru_cache(maxsize=1)
def _get_cached_kb_rows() -> tuple[dict[str, Any], ...]:
    return tuple(load_kb_rows())


@lru_cache(maxsize=1)
def get_embedding_model() -> SentenceTransformer:
    """Load and cache the `all-MiniLM-L6-v2` SentenceTransformer model once per process."""
    return SentenceTransformer(EMBEDDING_MODEL_NAME)


@lru_cache(maxsize=1)
def get_qdrant_client() -> QdrantClient:
    """Create and cache a Qdrant client pointed at `settings.QDRANT_URL`."""
    return QdrantClient(url=settings.QDRANT_URL)


def embed(text: str) -> list[float]:
    """Encode a single text string into a normalized 384-d float embedding."""
    model = get_embedding_model()
    vector = model.encode(text, normalize_embeddings=True)
    return vector.tolist()


def _build_qdrant_filter(
    *,
    type: Optional[str] = None,
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
) -> Optional[qdrant_models.Filter]:
    conditions: list[qdrant_models.FieldCondition] = []
    if type:
        conditions.append(
            qdrant_models.FieldCondition(
                key="type",
                match=qdrant_models.MatchValue(value=type.strip().lower()),
            )
        )
    if difficulty:
        conditions.append(
            qdrant_models.FieldCondition(
                key="difficulty",
                match=qdrant_models.MatchValue(value=difficulty.strip().lower()),
            )
        )
    if topic:
        conditions.append(
            qdrant_models.FieldCondition(
                key="topic",
                match=qdrant_models.MatchValue(value=topic.strip().lower()),
            )
        )
    return qdrant_models.Filter(must=conditions) if conditions else None


def retrieve(
    query: str,
    type: Optional[str] = None,
    difficulty: Optional[str] = None,
    topic: Optional[str] = None,
    k: int = 4,
    *,
    client: Optional[QdrantClient] = None,
    collection_name: str = KB_COLLECTION_NAME,
) -> list[dict[str, Any]]:
    """Retrieve the top-k matching knowledge base chunks from Qdrant with payload filters."""
    qdrant = client or get_qdrant_client()
    query_vector = embed(query)
    query_filter = _build_qdrant_filter(type=type, difficulty=difficulty, topic=topic)

    # Prefer modern qdrant-client `query_points`; fall back to `search` for older installs
    if hasattr(qdrant, "query_points"):
        response = qdrant.query_points(
            collection_name=collection_name,
            query=query_vector,
            query_filter=query_filter,
            limit=k,
            with_payload=True,
        )
        points = response.points
    else:
        points = qdrant.search(
            collection_name=collection_name,
            query_vector=query_vector,
            query_filter=query_filter,
            limit=k,
            with_payload=True,
        )

    results: list[dict[str, Any]] = []
    for hit in points:
        payload = hit.payload or {}
        results.append(
            {
                "text": str(payload.get("text", "")),
                "question": str(payload.get("question", "")),
                "reference_answer": str(payload.get("reference_answer", "")),
                "topic": str(payload.get("topic", "")),
                "type": str(payload.get("type", "")),
                "difficulty": str(payload.get("difficulty", "")),
                "expected_concepts": list(payload.get("expected_concepts") or []),
                "score": round(float(hit.score), 4),
            }
        )
    return results


def get_reference_for_question(
    question_text: str,
    topic: Optional[str] = None,
    *,
    client: Optional[QdrantClient] = None,
) -> Optional[dict[str, Any]]:
    """Return the best matching KB chunk (reference answer + expected concepts) for a question."""
    hits = retrieve(question_text, topic=topic, k=1, client=client)
    if not hits and topic:
        # Fallback without topic filter if no chunks matched the exact topic slug
        hits = retrieve(question_text, k=1, client=client)
    return hits[0] if hits else None


def sample_bank_question(
    type: str,
    difficulty: str,
    exclude_questions: Optional[Iterable[str]] = None,
    *,
    topic: Optional[str] = None,
    kb_dir: Optional[Path] = None,
) -> dict[str, Any]:
    """Return a random question dict from the CSV knowledge base as a fallback bank."""
    rows = load_kb_rows(kb_dir) if kb_dir is not None else list(_get_cached_kb_rows())
    norm_type = type.strip().lower()
    norm_diff = difficulty.strip().lower()
    norm_topic = topic.strip().lower() if topic else None
    excluded = {q.strip().lower() for q in (exclude_questions or []) if q and q.strip()}

    def _filter(match_diff: bool, match_topic: bool, apply_exclude: bool) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in rows:
            if row["type"] != norm_type:
                continue
            if match_diff and row["difficulty"] != norm_diff:
                continue
            if match_topic and norm_topic and row["topic"] != norm_topic:
                continue
            if apply_exclude and row["question"].strip().lower() in excluded:
                continue
            out.append(row)
        return out

    # Progressive fallback so sampling never fails when exclusions exhaust a small bucket
    candidates = (
        _filter(match_diff=True, match_topic=True, apply_exclude=True)
        or _filter(match_diff=False, match_topic=True, apply_exclude=True)
        or _filter(match_diff=False, match_topic=False, apply_exclude=True)
        or _filter(match_diff=False, match_topic=False, apply_exclude=False)
    )
    if not candidates:
        raise ValueError(
            f"No knowledge base questions found for type='{type}', difficulty='{difficulty}'."
        )

    picked = random.choice(candidates)
    return {
        "question": picked["question"],
        "reference_answer": picked["reference_answer"],
        "type": picked["type"],
        "difficulty": picked["difficulty"],
        "topic": picked["topic"],
        "expected_concepts": list(picked["expected_concepts"]),
    }
