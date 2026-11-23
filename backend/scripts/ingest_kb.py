"""Idempotent ingestion script: embeds backend/data/kb/*.csv and upserts into Qdrant collection 'kb'."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

# Allow running directly via `python scripts/ingest_kb.py` from `backend/`
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from app.rag import (
    DEFAULT_KB_DIR,
    EMBEDDING_DIM,
    KB_COLLECTION_NAME,
    get_embedding_model,
    get_qdrant_client,
    load_kb_rows,
)


def ensure_kb_collection(
    client: QdrantClient,
    collection_name: str = KB_COLLECTION_NAME,
) -> None:
    """Create the cosine-similarity Qdrant collection and payload indexes if missing."""
    if not client.collection_exists(collection_name=collection_name):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=qdrant_models.VectorParams(
                size=EMBEDDING_DIM,
                distance=qdrant_models.Distance.COSINE,
            ),
        )
        for field_name in ("topic", "type", "difficulty"):
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=qdrant_models.PayloadSchemaType.KEYWORD,
            )


def ingest_kb(
    kb_dir: Optional[Path] = None,
    *,
    client: Optional[QdrantClient] = None,
    collection_name: str = KB_COLLECTION_NAME,
    batch_size: int = 64,
) -> int:
    """Read all KB CSVs, embed chunks with all-MiniLM-L6-v2, and upsert idempotently into Qdrant."""
    rows = load_kb_rows(kb_dir or DEFAULT_KB_DIR)
    if not rows:
        return 0

    qdrant = client or get_qdrant_client()
    ensure_kb_collection(qdrant, collection_name=collection_name)

    model = get_embedding_model()
    chunk_texts = [row["text"] for row in rows]
    vectors = model.encode(
        chunk_texts,
        normalize_embeddings=True,
        show_progress_bar=False,
    )

    points = [
        qdrant_models.PointStruct(
            id=row["id"],
            vector=vec.tolist(),
            payload={
                "text": row["text"],
                "question": row["question"],
                "reference_answer": row["reference_answer"],
                "topic": row["topic"],
                "type": row["type"],
                "difficulty": row["difficulty"],
                "expected_concepts": row["expected_concepts"],
                "source_file": row["source_file"],
            },
        )
        for row, vec in zip(rows, vectors)
    ]

    for start in range(0, len(points), batch_size):
        qdrant.upsert(
            collection_name=collection_name,
            points=points[start : start + batch_size],
            wait=True,
        )

    return len(points)


if __name__ == "__main__":
    count = ingest_kb()
    print(f"Ingested {count} knowledge base chunks into Qdrant collection '{KB_COLLECTION_NAME}'.")
