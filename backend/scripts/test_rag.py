"""Quick end-to-end smoke test: ingest KB into Qdrant and print top 3 results for a DBMS query."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.rag import get_reference_for_question, retrieve, sample_bank_question
from scripts.ingest_kb import ingest_kb


def main() -> None:
    query = "explain normalization in DBMS"

    print("1) Ingesting knowledge base into Qdrant...")
    total = ingest_kb()
    print(f"   Upserted {total} chunks (re-running is idempotent).\n")

    print(f"2) Top 3 retrieval results for: '{query}'")
    results = retrieve(query, k=3)
    for rank, item in enumerate(results, start=1):
        print(
            f"\n   #{rank} [score={item['score']:.4f}] "
            f"topic={item['topic']} | type={item['type']} | difficulty={item['difficulty']}"
        )
        print(f"   Expected Concepts: {', '.join(item['expected_concepts'])}")
        print(f"   Chunk Preview:\n   {item['text'].splitlines()[0]}")
        print(f"   {item['text'].splitlines()[1]}")

    print("\n3) Best reference lookup (topic='dbms'):")
    ref = get_reference_for_question(query, topic="dbms")
    if ref:
        print(f"   Matched topic={ref['topic']} score={ref['score']:.4f}")
        print(f"   Reference: {ref['reference_answer']}")

    print("\n4) Fallback CSV bank sample (behavioural, medium):")
    sample = sample_bank_question(type="behavioural", difficulty="medium", exclude_questions=[])
    print(f"   [{sample['topic']}/{sample['difficulty']}] {sample['question']}")


if __name__ == "__main__":
    main()
