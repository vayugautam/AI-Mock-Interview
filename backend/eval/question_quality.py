"""Generate 20 interview questions across roles/difficulties and measure quality metrics.

Reports:
  - Valid-schema output rate (across LLM generation attempts)
  - Duplicate rejection rate (cosine >= 0.85 or exact match against prior session questions)
  - Fallback rate (how often generation fell back to the CSV bank)
  - Mean generation latency per question

Run from `backend/`:
    python -m eval.question_quality
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import llm, questions, rag  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_CSV = EVAL_DIR / "question_quality_results.csv"
DEFAULT_OUT_MD = EVAL_DIR / "question_quality_results.md"


@dataclass
class MockSession:
    id: int
    role: str
    experience_level: str
    interview_type: str
    difficulty: str
    total_questions: int
    skills: list[str] = field(default_factory=list)


# 5 diverse sessions x 4 questions = 20 total questions across roles, types, and difficulties
SESSION_MATRIX: list[MockSession] = [
    MockSession(1, "Backend Engineer", "Fresher", "technical", "easy", 4, ["Python", "SQL", "FastAPI"]),
    MockSession(2, "Full-Stack Engineer", "Junior", "technical", "medium", 4, ["React", "PostgreSQL", "Docker"]),
    MockSession(3, "ML Engineer", "Fresher", "technical", "hard", 4, ["PyTorch", "RAG", "NLP"]),
    MockSession(4, "Systems Engineer", "Intern", "technical", "medium", 4, ["Linux", "C++", "TCP/IP"]),
    MockSession(5, "Software Engineer", "Fresher", "behavioural", "medium", 4, ["Teamwork", "Communication"]),
]


def run_question_quality(
    total_target: int = 20,
    out_csv: Path = DEFAULT_OUT_CSV,
    out_md: Path = DEFAULT_OUT_MD,
) -> None:
    stats = {
        "llm_attempts": 0,
        "valid_schema_attempts": 0,
        "duplicate_rejections": 0,
        "fallback_count": 0,
    }

    orig_call_llm_json = llm.call_llm_json
    orig_is_duplicate = questions._is_duplicate_question
    orig_sample_bank = rag.sample_bank_question

    current_call_used_fallback = {"flag": False}

    def traced_call_llm_json(system: str, user: str, temperature: float = 0.0) -> dict[str, Any]:
        stats["llm_attempts"] += 1
        raw = orig_call_llm_json(system, user, temperature=temperature)
        try:
            questions.GeneratedQuestionPayload.model_validate(raw)
            stats["valid_schema_attempts"] += 1
        except ValidationError:
            pass
        return raw

    def traced_is_duplicate(
        candidate_question: str,
        previous_texts: list[str],
        previous_embeddings: list[list[float]],
        threshold: float = questions.DUPLICATE_SIMILARITY_THRESHOLD,
    ) -> tuple[bool, float]:
        is_dup, max_sim = orig_is_duplicate(
            candidate_question, previous_texts, previous_embeddings, threshold=threshold
        )
        if is_dup:
            stats["duplicate_rejections"] += 1
        return is_dup, max_sim

    def traced_sample_bank(*args: Any, **kwargs: Any) -> dict[str, Any]:
        current_call_used_fallback["flag"] = True
        stats["fallback_count"] += 1
        return orig_sample_bank(*args, **kwargs)

    llm.call_llm_json = traced_call_llm_json
    questions._is_duplicate_question = traced_is_duplicate
    rag.sample_bank_question = traced_sample_bank

    generated_rows: list[dict[str, Any]] = []
    latencies: list[float] = []

    try:
        for sess in SESSION_MATRIX:
            prev_questions: list[str] = []
            for q_num in range(1, sess.total_questions + 1):
                if len(generated_rows) >= total_target:
                    break
                current_call_used_fallback["flag"] = False
                t0 = time.perf_counter()
                result = questions.generate_question(sess, prev_questions)
                elapsed = round(time.perf_counter() - t0, 3)
                latencies.append(elapsed)
                prev_questions.append(result["question"])

                row = {
                    "index": len(generated_rows) + 1,
                    "session_id": sess.id,
                    "role": sess.role,
                    "type": result["type"],
                    "difficulty": result["difficulty"],
                    "topic": result["topic"],
                    "word_count": len(result["question"].split()),
                    "concept_count": len(result["expected_concepts"]),
                    "used_fallback": current_call_used_fallback["flag"],
                    "gen_time_sec": elapsed,
                    "question": result["question"],
                }
                generated_rows.append(row)
                tag = "FALLBACK" if row["used_fallback"] else "LLM"
                print(
                    f"[{row['index']:02d}/{total_target:02d}] {sess.role:<19} | "
                    f"{result['difficulty']:<6} | {result['topic']:<5} | {tag:<8} | "
                    f"{elapsed:.2f}s | {result['question'][:60]}"
                )
    finally:
        llm.call_llm_json = orig_call_llm_json
        questions._is_duplicate_question = orig_is_duplicate
        rag.sample_bank_question = orig_sample_bank

    n_gen = len(generated_rows)
    valid_schema_rate = (
        stats["valid_schema_attempts"] / stats["llm_attempts"] if stats["llm_attempts"] else 0.0
    )
    duplicate_rate = (
        stats["duplicate_rejections"] / stats["llm_attempts"] if stats["llm_attempts"] else 0.0
    )
    fallback_rate = stats["fallback_count"] / n_gen if n_gen else 0.0
    mean_time = sum(latencies) / len(latencies) if latencies else 0.0

    # Save CSV
    if generated_rows:
        with out_csv.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(generated_rows[0].keys()))
            writer.writeheader()
            writer.writerows(generated_rows)

    summary_md = "\n".join(
        [
            "# Question Generation Quality Report",
            "",
            "| Metric | Value |",
            "| --- | ---: |",
            f"| Questions generated | {n_gen} |",
            f"| Total LLM attempts | {stats['llm_attempts']} |",
            f"| Valid-schema rate | {valid_schema_rate * 100:.1f}% ({stats['valid_schema_attempts']}/{stats['llm_attempts']}) |",
            f"| Duplicate rejection rate | {duplicate_rate * 100:.1f}% ({stats['duplicate_rejections']}/{stats['llm_attempts']}) |",
            f"| Fallback rate | {fallback_rate * 100:.1f}% ({stats['fallback_count']}/{n_gen}) |",
            f"| Mean generation time | {mean_time:.2f}s |",
            "",
        ]
    )
    out_md.write_text(summary_md, encoding="utf-8")

    print("\n" + "=" * 62)
    print(f"Questions generated      : {n_gen}")
    print(f"Total LLM attempts       : {stats['llm_attempts']}")
    print(f"Valid-schema rate        : {valid_schema_rate * 100:.1f}%")
    print(f"Duplicate rejection rate : {duplicate_rate * 100:.1f}%")
    print(f"Fallback rate            : {fallback_rate * 100:.1f}%")
    print(f"Mean generation time     : {mean_time:.2f}s")
    print("=" * 62)
    print(f"Saved details to: {out_csv} and {out_md}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark question generation quality across 20 questions.")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--out-csv", type=Path, default=DEFAULT_OUT_CSV)
    parser.add_argument("--out-md", type=Path, default=DEFAULT_OUT_MD)
    args = parser.parse_args()
    run_question_quality(total_target=args.count, out_csv=args.out_csv, out_md=args.out_md)


if __name__ == "__main__":
    main()
