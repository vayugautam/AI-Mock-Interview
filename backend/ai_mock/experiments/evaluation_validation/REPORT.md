# Text evaluator validation pilot report

**Dataset:** `dataset_v1.json`  
**Provider:** `deterministic_mock`  
**Run:** 2026-10-29  
**Sample size:** 10 answers (2 each: strong, average, incomplete, incorrect, off-topic)

## Results

| Measure | Result |
|---|---:|
| Human-annotated items | 0 |
| Paired model/human items | 0 |
| Mean absolute error | Not computed |
| Pearson correlation | Not computed |
| Spearman correlation | Not computed |
| Performance-band agreement | Not computed |
| Mean evaluator latency | 0.417 ms |
| Maximum evaluator latency | 0.769 ms |
| Provider failures | 0 / 10 (0%) |

The latency and failure measurements are for the local deterministic provider,
not a live Groq request. They should not be used as estimates of networked Groq
latency or availability.

## Interpretation

This run verifies that the dataset, provider invocation, timing, failure
recording, and analysis pipeline are reproducible. It does **not** validate
agreement or accuracy because the repository contains no independent human
scores. The empty `human_annotations.csv` is an annotation template, not
ground truth. Human scores must be collected independently before MAE,
correlations, band agreement, or category-level error can be reported.

The pilot is small, covers only ten typed answers, uses a fixed hand-authored
split, and evaluates a deterministic heuristic provider. It does not establish
objectivity, calibration, generalization, or equivalence to Groq.

## Next measurement

Have two or more annotators independently complete
`human_annotations.csv` without seeing model outputs, resolve disagreements
afterward, and rerun:

```text
python experiments/evaluation_validation/analyze.py
```

The script averages available independent annotations per item and reports
criterion-level and overall MAE, Pearson/Spearman only when variation and
sample-size conditions permit, predefined band agreement, and error by answer
category.
