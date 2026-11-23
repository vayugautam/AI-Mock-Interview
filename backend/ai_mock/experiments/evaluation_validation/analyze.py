"""Run the reproducible text-evaluator validation pilot."""

from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path
from statistics import mean
from typing import Any

from app.services.evaluation_provider import DeterministicMockEvaluationProvider
from app.services.evaluation_service import calculate_overall_score

CRITERIA = (
    "correctness_score",
    "relevance_score",
    "completeness_score",
    "clarity_score",
)


def load_annotations(path: Path) -> dict[str, dict[str, float | bool]]:
    grouped: dict[str, list[dict[str, str]]] = {}
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            grouped.setdefault(row["item_id"], []).append(row)

    annotations: dict[str, dict[str, float | bool]] = {}
    for item_id, rows in grouped.items():
        complete = []
        for row in rows:
            if all(row.get(criteria, "").strip() for criteria in CRITERIA):
                complete.append(row)
        if not complete:
            continue
        values = {
            criteria: mean(float(row[criteria]) for row in complete)
            for criteria in CRITERIA
        }
        off_topic_values = [row.get("off_topic", "").strip().lower() for row in complete]
        if all(value in {"true", "false"} for value in off_topic_values):
            values["off_topic"] = sum(value == "true" for value in off_topic_values) > len(off_topic_values) / 2
        annotations[item_id] = values
    return annotations


def rank(values: list[float]) -> list[float]:
    ordered = sorted(enumerate(values), key=lambda pair: pair[1])
    ranks = [0.0] * len(values)
    index = 0
    while index < len(ordered):
        end = index
        while end + 1 < len(ordered) and ordered[end + 1][1] == ordered[index][1]:
            end += 1
        average_rank = (index + end + 2) / 2
        for position in range(index, end + 1):
            ranks[ordered[position][0]] = average_rank
        index = end + 1
    return ranks


def correlation(left: list[float], right: list[float]) -> float | None:
    if len(left) < 3 or len(set(left)) < 2 or len(set(right)) < 2:
        return None
    left_mean, right_mean = mean(left), mean(right)
    numerator = sum((a - left_mean) * (b - right_mean) for a, b in zip(left, right))
    denominator = math.sqrt(
        sum((a - left_mean) ** 2 for a in left)
        * sum((b - right_mean) ** 2 for b in right)
    )
    return round(numerator / denominator, 4) if denominator else None


def band(score: float) -> str:
    if score < 4:
        return "needs_work"
    if score < 7:
        return "developing"
    return "strong"


def analyze(dataset_path: Path, annotations_path: Path) -> dict[str, Any]:
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    annotations = load_annotations(annotations_path)
    provider = DeterministicMockEvaluationProvider()
    predictions: list[dict[str, Any]] = []
    failures = 0
    for item in dataset["items"]:
        started = time.perf_counter()
        try:
            result = provider.evaluate(
                question_text=item["question"],
                answer_text=item["answer"],
            )
            elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
            predictions.append({
                "item_id": item["item_id"],
                "category": item["category"],
                "latency_ms": elapsed_ms,
                "provider": provider.provider_name,
                "scores": {criteria: float(getattr(result, criteria)) for criteria in CRITERIA},
                "overall_score": float(calculate_overall_score(result)),
                "is_off_topic": result.is_off_topic,
            })
        except Exception as exc:  # noqa: BLE001 - experiment records provider failures.
            failures += 1
            predictions.append({
                "item_id": item["item_id"],
                "category": item["category"],
                "error": type(exc).__name__,
            })

    paired = [item for item in predictions if item["item_id"] in annotations and "scores" in item]
    metrics: dict[str, Any] = {
        "human_annotated_items": len(annotations),
        "paired_items": len(paired),
        "criteria": {},
        "band_agreement": None,
        "category_error_analysis": {},
    }
    if paired:
        all_model_overall, all_human_overall = [], []
        for criteria in CRITERIA:
            model_values = [item["scores"][criteria] for item in paired]
            human_values = [float(annotations[item["item_id"]][criteria]) for item in paired]
            metrics["criteria"][criteria] = {
                "mae": round(mean(abs(a - b) for a, b in zip(model_values, human_values)), 4),
                "pearson": correlation(model_values, human_values),
                "spearman": correlation(rank(model_values), rank(human_values)),
            }
        for item in paired:
            model_overall = sum(
                item["scores"][criteria] * float(weight)
                for criteria, weight in dataset["rubric"]["weights"].items()
            )
            human_overall = sum(
                float(annotations[item["item_id"]][criteria]) * float(weight)
                for criteria, weight in dataset["rubric"]["weights"].items()
            )
            all_model_overall.append(model_overall)
            all_human_overall.append(human_overall)
            item["_model_overall"] = model_overall
            item["_human_overall"] = human_overall
        metrics["overall"] = {
            "mae": round(mean(abs(a - b) for a, b in zip(all_model_overall, all_human_overall)), 4),
            "pearson": correlation(all_model_overall, all_human_overall),
            "spearman": correlation(rank(all_model_overall), rank(all_human_overall)),
        }
        matches = sum(band(a) == band(b) for a, b in zip(all_model_overall, all_human_overall))
        metrics["band_agreement"] = round(matches / len(paired), 4)
        for category in sorted({item["category"] for item in paired}):
            category_items = [item for item in paired if item["category"] == category]
            metrics["category_error_analysis"][category] = {
                "n": len(category_items),
                "overall_mae": round(mean(abs(item["_model_overall"] - item["_human_overall"]) for item in category_items), 4),
            }
        for item in paired:
            item.pop("_model_overall", None)
            item.pop("_human_overall", None)
    latency_values = [item["latency_ms"] for item in predictions if "latency_ms" in item]
    metrics["latency_ms"] = {
        "n": len(latency_values),
        "mean": round(mean(latency_values), 3) if latency_values else None,
        "max": max(latency_values) if latency_values else None,
    }
    metrics["provider_failure_rate"] = round(failures / len(dataset["items"]), 4)
    return {
        "dataset_version": dataset["dataset_version"],
        "sample_size": len(dataset["items"]),
        "provider": provider.provider_name,
        "metrics": metrics,
        "predictions": predictions,
        "limitations": [
            "No independent human annotations were supplied; agreement metrics are unavailable."
            if not annotations else
            "Human scores are averaged across available annotators; adjudication was not modeled.",
            "The pilot has only ten items and is not evidence of objective or calibrated evaluation.",
            "The deterministic provider is not representative of a live Groq model.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    root = Path(__file__).parent
    parser.add_argument("--dataset", type=Path, default=root / "dataset_v1.json")
    parser.add_argument("--annotations", type=Path, default=root / "human_annotations.csv")
    parser.add_argument("--output", type=Path, default=root / "results.json")
    args = parser.parse_args()
    result = analyze(args.dataset, args.annotations)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["metrics"], indent=2))


if __name__ == "__main__":
    main()
