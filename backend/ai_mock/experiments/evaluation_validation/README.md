# Text evaluator validation experiment

This is a small, versioned pilot dataset for typed-answer evaluation. It
contains two technical questions in each of five quality categories: strong,
average, incomplete, incorrect, and off-topic.

## Annotation procedure

Two annotators should independently score every item in
`human_annotations.csv` using the same 0-10 rubric:

1. Technical correctness
2. Relevance to the question
3. Completeness of the expected explanation
4. Clarity and structure

Annotators should not see model scores or each other's scores. `off_topic` is a
separate boolean judgment. Resolve disagreements only after independent scoring,
and record the adjudicated score in a separate copy or an explicitly named
adjudication file.

The model is never used as ground truth. The included CSV is intentionally an
empty annotation template because no independent team annotations were
available in this repository.

## Reproducible command

From `backend`:

```text
python experiments/evaluation_validation/analyze.py
```

Optional arguments:

```text
python experiments/evaluation_validation/analyze.py \
  --annotations experiments/evaluation_validation/human_annotations.csv \
  --output experiments/evaluation_validation/results.json
```

The script runs the deterministic mock provider by default, records per-item
latency and failures, and calculates MAE, Pearson, Spearman, band agreement,
and category error analysis only for items with complete human annotations.

The dataset is a pilot, not a validation study. Results are sensitive to the
small sample, question coverage, annotator interpretation, and the
deterministic provider's heuristic behavior.
