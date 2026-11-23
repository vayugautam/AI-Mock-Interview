"""Evaluate feature-level and decision-level fusion against human annotations.

Reads `eval/annotated_answers.csv`, runs `content_features` + `evaluate_with_llm`
(text-only, delivery=None), computes both fusion scores, reports Pearson, Spearman,
MAE, performance-band accuracy, and mean latency, and writes `eval/results.csv`
and `eval/results.md`.

Run from `backend/`:
    python -m eval.run_eval
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path
from typing import Any, Optional

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import evaluator, features, fusion, scoring, speech  # noqa: E402

EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = EVAL_DIR / "annotated_answers.csv"
DEFAULT_OUT_CSV = EVAL_DIR / "results.csv"
DEFAULT_OUT_MD = EVAL_DIR / "results.md"


def parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def resolve_human_mean(row: dict[str, str]) -> Optional[float]:
    """Use `human_mean` if filled, otherwise average non-blank `human_scorer_1..3`."""
    direct = parse_float(row.get("human_mean"))
    if direct is not None:
        return round(direct, 4)

    scorer_vals = [
        val
        for col in ("human_scorer_1", "human_scorer_2", "human_scorer_3")
        if (val := parse_float(row.get(col))) is not None
    ]
    if not scorer_vals:
        return None
    return round(sum(scorer_vals) / len(scorer_vals), 4)


def pearson_r(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 2 or n != len(ys):
        return None
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs))
    den_y = math.sqrt(sum((y - mean_y) ** 2 for y in ys))
    if den_x == 0.0 or den_y == 0.0:
        return None
    return num / (den_x * den_y)


def _average_ranks(values: list[float]) -> list[float]:
    indexed = sorted(enumerate(values), key=lambda pair: pair[1])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(indexed):
        j = i
        while j + 1 < len(indexed) and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg_rank = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg_rank
        i = j + 1
    return ranks


def spearman_rho(xs: list[float], ys: list[float]) -> Optional[float]:
    if len(xs) < 2 or len(xs) != len(ys):
        return None
    return pearson_r(_average_ranks(xs), _average_ranks(ys))


def mae(preds: list[float], targets: list[float]) -> Optional[float]:
    if not preds or len(preds) != len(targets):
        return None
    return sum(abs(p - t) for p, t in zip(preds, targets)) / len(preds)


def band_accuracy(preds: list[float], targets: list[float]) -> Optional[float]:
    if not preds or len(preds) != len(targets):
        return None
    matches = sum(1 for p, t in zip(preds, targets) if scoring.band(p) == scoring.band(t))
    return matches / len(preds)


def compute_method_metrics(
    records: list[dict[str, Any]],
    score_key: str,
) -> dict[str, Optional[float]]:
    paired = [
        (float(r[score_key]), float(r["human_mean"]))
        for r in records
        if r.get("human_mean") is not None and r.get(score_key) is not None
    ]
    preds = [p for p, _ in paired]
    humans = [h for _, h in paired]
    latencies = [float(r["response_time_sec"]) for r in records if r.get("response_time_sec") is not None]

    return {
        "n_scored": float(len(paired)),
        "pearson": pearson_r(preds, humans),
        "spearman": spearman_rho(preds, humans),
        "mae": mae(preds, humans),
        "band_accuracy": band_accuracy(preds, humans),
        "mean_time_sec": (sum(latencies) / len(latencies)) if latencies else None,
    }


def _fmt(val: Optional[float], digits: int = 3, pct: bool = False) -> str:
    if val is None:
        return "N/A"
    if pct:
        return f"{val * 100:.1f}%"
    return f"{val:.{digits}f}"


def render_summary_markdown(
    records: list[dict[str, Any]],
    feat_metrics: dict[str, Optional[float]],
    dec_metrics: dict[str, Optional[float]],
) -> str:
    n_total = len(records)
    n_annotated = int(feat_metrics["n_scored"] or 0)
    lines = [
        "# Evaluation Results (Feature-Level vs Decision-Level Fusion)",
        "",
        f"- Total rows evaluated: **{n_total}**",
        f"- Rows with human annotations (`human_mean`): **{n_annotated}**",
        "- Mode: Text-only (`delivery_features = None`, decision weights renormalized)",
        "",
        "## Fusion Strategy Comparison",
        "",
        "| Method | Pearson r | Spearman rho | MAE (0-10) | Band Accuracy | Mean Time (s) |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        (
            f"| feature_level | {_fmt(feat_metrics['pearson'])} | {_fmt(feat_metrics['spearman'])} | "
            f"{_fmt(feat_metrics['mae'])} | {_fmt(feat_metrics['band_accuracy'], pct=True)} | "
            f"{_fmt(feat_metrics['mean_time_sec'], digits=2)} |"
        ),
        (
            f"| decision_level | {_fmt(dec_metrics['pearson'])} | {_fmt(dec_metrics['spearman'])} | "
            f"{_fmt(dec_metrics['mae'])} | {_fmt(dec_metrics['band_accuracy'], pct=True)} | "
            f"{_fmt(dec_metrics['mean_time_sec'], digits=2)} |"
        ),
        "",
        "## Per-Quality Tier Mean Scores",
        "",
        "| Quality Tier | Count | Human Mean | Feature-Level Mean | Decision-Level Mean |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]

    for tier in ("strong", "average", "weak", "off-topic"):
        bucket = [r for r in records if r["answer_quality"] == tier]
        if not bucket:
            continue
        h_vals = [float(r["human_mean"]) for r in bucket if r["human_mean"] is not None]
        f_vals = [float(r["feature_level_score"]) for r in bucket]
        d_vals = [float(r["decision_level_score"]) for r in bucket]
        h_avg = sum(h_vals) / len(h_vals) if h_vals else None
        f_avg = sum(f_vals) / len(f_vals)
        d_avg = sum(d_vals) / len(d_vals)
        lines.append(
            f"| {tier} | {len(bucket)} | {_fmt(h_avg, 2)} | {_fmt(f_avg, 2)} | {_fmt(d_avg, 2)} |"
        )

    return "\n".join(lines) + "\n"


def run_evaluation(
    input_csv: Path,
    out_csv: Path,
    out_md: Path,
    limit: Optional[int] = None,
) -> None:
    if not input_csv.is_file():
        raise FileNotFoundError(f"Annotated answers CSV not found: {input_csv}")

    with input_csv.open("r", encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh))

    if limit is not None:
        rows = rows[:limit]

    records: list[dict[str, Any]] = []
    for idx, row in enumerate(rows, start=1):
        qid = (row.get("question_id") or f"Q{idx}").strip()
        question = (row.get("question") or "").strip()
        q_type = (row.get("type") or "technical").strip().lower()
        expected_concepts = [
            c.strip() for c in (row.get("expected_concepts") or "").split("|") if c.strip()
        ]
        reference_context = (row.get("reference_context") or "").strip()
        answer_text = (row.get("answer_text") or "").strip()
        quality = (row.get("answer_quality") or "").strip().lower()
        human_mean = resolve_human_mean(row)

        cleaned_answer = speech.clean_transcript(answer_text)
        t0 = time.perf_counter()
        c_feats = features.content_features(
            question=question,
            cleaned_answer=cleaned_answer,
            reference_chunk=reference_context,
            expected_concepts=expected_concepts,
            interview_type=q_type,
        )
        llm_res = evaluator.evaluate_with_llm(
            question=question,
            answer_text=cleaned_answer,
            expected_concepts=expected_concepts,
            reference_context=reference_context,
            content_features=c_feats,
            delivery_features_or_None=None,
            interview_type=q_type,
        )
        feat_score = fusion.feature_level(llm_res, scoring.WEIGHTS[q_type])
        dec_score = fusion.decision_level(
            llm_score=feat_score,
            sim_reference=float(c_feats["sim_reference"]),
            concept_coverage=float(c_feats["concept_coverage"]),
            delivery_score_or_None=None,
        )
        elapsed = round(time.perf_counter() - t0, 3)

        records.append(
            {
                "question_id": qid,
                "type": q_type,
                "answer_quality": quality,
                "human_mean": human_mean,
                "human_band": scoring.band(human_mean) if human_mean is not None else "",
                "sim_question": c_feats["sim_question"],
                "sim_reference": c_feats["sim_reference"],
                "concept_coverage": c_feats["concept_coverage"],
                "word_count": c_feats["word_count"],
                "length_score": c_feats["length_score"],
                "feature_level_score": feat_score,
                "feature_level_band": scoring.band(feat_score),
                "decision_level_score": dec_score,
                "decision_level_band": scoring.band(dec_score),
                "response_time_sec": elapsed,
                "criterion_scores_json": json.dumps(llm_res["scores"], sort_keys=True),
            }
        )
        print(
            f"[{idx:02d}/{len(rows):02d}] {qid} ({quality:<9}) | "
            f"feat={feat_score:5.2f} dec={dec_score:5.2f} "
            f"human={_fmt(human_mean, 2):>5} | {elapsed:.2f}s"
        )

    fieldnames = list(records[0].keys()) if records else []
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with out_csv.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)

    feat_metrics = compute_method_metrics(records, "feature_level_score")
    dec_metrics = compute_method_metrics(records, "decision_level_score")

    md_report = render_summary_markdown(records, feat_metrics, dec_metrics)
    out_md.write_text(md_report, encoding="utf-8")

    print("\n" + "=" * 78)
    print(
        f"{'Method':<16} | {'Pearson':>8} | {'Spearman':>8} | "
        f"{'MAE':>7} | {'Band Acc':>9} | {'Mean Time':>9}"
    )
    print("-" * 78)
    for label, m in (("feature_level", feat_metrics), ("decision_level", dec_metrics)):
        print(
            f"{label:<16} | {_fmt(m['pearson']):>8} | {_fmt(m['spearman']):>8} | "
            f"{_fmt(m['mae']):>7} | {_fmt(m['band_accuracy'], pct=True):>9} | "
            f"{_fmt(m['mean_time_sec'], digits=2):>8}s"
        )
    print("=" * 78)

    if int(feat_metrics["n_scored"] or 0) == 0:
        print(
            "\nNote: human_scorer_1..3 / human_mean columns are currently blank in "
            f"{input_csv.name}. Fill them in and re-run to compute correlation, MAE, and band accuracy."
        )

    print(f"\nSaved per-row results to: {out_csv}")
    print(f"Saved markdown summary to: {out_md}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run offline evaluation against human scores.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--out-csv", type=Path, default=DEFAULT_OUT_CSV)
    parser.add_argument("--out-md", type=Path, default=DEFAULT_OUT_MD)
    parser.add_argument("--limit", type=int, default=None, help="Optional row limit for smoke tests.")
    args = parser.parse_args()
    run_evaluation(args.input, args.out_csv, args.out_md, limit=args.limit)


if __name__ == "__main__":
    main()
