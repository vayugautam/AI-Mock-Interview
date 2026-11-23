import csv
import json
from pathlib import Path

from experiments.evaluation_validation.analyze import analyze, correlation, rank


ROOT = Path(__file__).parents[1] / "experiments" / "evaluation_validation"


def test_experiment_runs_without_human_ground_truth():
    result = analyze(ROOT / "dataset_v1.json", ROOT / "human_annotations.csv")

    assert result["sample_size"] == 10
    assert result["metrics"]["paired_items"] == 0
    assert result["metrics"]["overall"] if "overall" in result["metrics"] else True
    assert result["metrics"]["provider_failure_rate"] == 0
    assert result["metrics"]["latency_ms"]["n"] == 10
    assert result["limitations"][0].startswith("No independent human annotations")


def test_analysis_calculates_metrics_for_completed_annotations(tmp_path):
    annotations = tmp_path / "annotations.csv"
    with annotations.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "item_id", "annotator_id", "correctness_score",
                "relevance_score", "completeness_score", "clarity_score", "off_topic",
            ],
        )
        writer.writeheader()
        for item_id in ("ds-001", "ds-002", "ds-003"):
            writer.writerow({
                "item_id": item_id,
                "annotator_id": "annotator_1",
                "correctness_score": 8,
                "relevance_score": 8,
                "completeness_score": 8,
                "clarity_score": 8,
                "off_topic": "false",
            })
    result = analyze(ROOT / "dataset_v1.json", annotations)

    assert result["metrics"]["paired_items"] == 3
    assert "mae" in result["metrics"]["overall"]
    assert result["metrics"]["band_agreement"] is not None


def test_rank_and_correlation_handle_ties_and_variation():
    assert rank([1, 1, 3]) == [1.5, 1.5, 3.0]
    assert correlation([1, 2, 3], [2, 4, 6]) == 1.0
    assert correlation([1, 1, 1], [1, 2, 3]) is None
