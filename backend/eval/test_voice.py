"""Evaluate voice transcription WER, delivery features, and delivery-fusion score delta.

Expects a folder (default: `eval/voice_samples/`) containing audio clips
(`.webm`, `.wav`, `.mp3`, `.m4a`, `.ogg`, `.flac`) paired with reference typed text:
  - Either a matching `<stem>.txt` file alongside each audio file, OR
  - A `manifest.csv` with columns:
      audio_file,reference_text,question,type,expected_concepts,reference_context
    (the last 4 columns are optional and default to a generic technical prompt).

Run from `backend/`:
    python -m eval.test_voice --samples-dir eval/voice_samples
    python -m eval.test_voice --samples-dir eval/voice_samples --no-llm
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Any, Optional

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import evaluator, features, fusion, scoring, speech  # noqa: E402

AUDIO_EXTS = frozenset({".webm", ".wav", ".mp3", ".m4a", ".ogg", ".flac"})
DEFAULT_SAMPLES_DIR = Path(__file__).resolve().parent / "voice_samples"


def _normalize_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", (text or "").lower())


def word_error_rate(reference_text: str, hypothesis_text: str) -> float:
    """Compute standard Word Error Rate: (S + D + I) / N using word-level Levenshtein distance."""
    ref = _normalize_words(reference_text)
    hyp = _normalize_words(hypothesis_text)
    if not ref:
        return 0.0 if not hyp else 1.0

    prev = list(range(len(hyp) + 1))
    for i, r_word in enumerate(ref, start=1):
        curr = [i] + [0] * len(hyp)
        for j, h_word in enumerate(hyp, start=1):
            cost = 0 if r_word == h_word else 1
            curr[j] = min(
                prev[j] + 1,      # deletion
                curr[j - 1] + 1,  # insertion
                prev[j - 1] + cost,  # substitution
            )
        prev = curr
    return prev[-1] / len(ref)


def discover_voice_samples(samples_dir: Path) -> list[dict[str, Any]]:
    """Load voice sample entries from `manifest.csv` or paired `<audio> + <stem>.txt` files."""
    if not samples_dir.is_dir():
        raise FileNotFoundError(
            f"Voice samples directory not found: {samples_dir}\n"
            "Create the directory and add audio clips (.webm/.wav) with matching .txt files "
            "or a manifest.csv."
        )

    manifest_path = samples_dir / "manifest.csv"
    samples: list[dict[str, Any]] = []

    if manifest_path.is_file():
        with manifest_path.open("r", encoding="utf-8", newline="") as fh:
            for row in csv.DictReader(fh):
                audio_file = (row.get("audio_file") or "").strip()
                if not audio_file:
                    continue
                samples.append(
                    {
                        "audio_path": samples_dir / audio_file,
                        "reference_text": (row.get("reference_text") or "").strip(),
                        "question": (row.get("question") or "Explain the concept clearly.").strip(),
                        "type": (row.get("type") or "technical").strip().lower(),
                        "expected_concepts": [
                            c.strip()
                            for c in (row.get("expected_concepts") or "").split("|")
                            if c.strip()
                        ],
                        "reference_context": (row.get("reference_context") or "").strip(),
                    }
                )
        return samples

    for path in sorted(samples_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
            continue
        if path.stem.endswith("_processed"):
            continue
        txt_path = path.with_suffix(".txt")
        if not txt_path.is_file():
            print(f"Skipping {path.name}: missing matching reference text file {txt_path.name}")
            continue
        samples.append(
            {
                "audio_path": path,
                "reference_text": txt_path.read_text(encoding="utf-8").strip(),
                "question": "Explain the concept clearly.",
                "type": "technical",
                "expected_concepts": [],
                "reference_context": "",
            }
        )

    return samples


def run_voice_eval(samples_dir: Path, use_llm: bool = True) -> None:
    samples = discover_voice_samples(samples_dir)
    if not samples:
        print(
            f"No voice samples found in {samples_dir}.\n"
            "Add audio files (e.g., sample1.webm) with matching sample1.txt reference transcripts "
            "or a manifest.csv."
        )
        return

    header = (
        f"{'File':<18} | {'WER':>6} | {'WPM':>6} | {'Pauses/m':>8} | {'Fillers':>7} | "
        f"{'Dur(s)':>6} | {'Deliv/10':>8} | {'TextOnly':>8} | {'WithDeliv':>9} | {'Delta':>6}"
    )
    print(header)
    print("-" * len(header))

    wers: list[float] = []
    deltas: list[float] = []

    for item in samples:
        audio_path: Path = item["audio_path"]
        ref_text: str = item["reference_text"]
        q_type: str = item["type"]

        processed_wav = speech.preprocess_audio(audio_path)
        duration_sec = speech.get_audio_duration_sec(processed_wav)
        transcript = speech.transcribe(processed_wav)
        raw_text = str(transcript.get("text") or "").strip()
        words = list(transcript.get("words") or [])
        cleaned_text = speech.clean_transcript(raw_text)
        deliv = speech.delivery_features(words, duration_sec, raw_text=raw_text)
        deliv_score = fusion.compute_delivery_score(deliv) or 0.0

        wer = word_error_rate(ref_text, raw_text)
        wers.append(wer)

        ref_context = item["reference_context"] or ref_text
        c_feats = features.content_features(
            question=item["question"],
            cleaned_answer=cleaned_text,
            reference_chunk=ref_context,
            expected_concepts=item["expected_concepts"],
            interview_type=q_type,
        )

        if use_llm:
            llm_text_only = evaluator.evaluate_with_llm(
                question=item["question"],
                answer_text=cleaned_text,
                expected_concepts=item["expected_concepts"],
                reference_context=ref_context,
                content_features=c_feats,
                delivery_features_or_None=None,
                interview_type=q_type,
            )
            base_llm_score = fusion.feature_level(llm_text_only, scoring.WEIGHTS[q_type])
        else:
            # Offline proxy when --no-llm is set: content score on 0-10 scale
            base_llm_score = fusion.compute_content_score(
                float(c_feats["sim_reference"]),
                float(c_feats["concept_coverage"]),
            )

        score_text_only = fusion.decision_level(
            llm_score=base_llm_score,
            sim_reference=float(c_feats["sim_reference"]),
            concept_coverage=float(c_feats["concept_coverage"]),
            delivery_score_or_None=None,
        )
        score_with_delivery = fusion.decision_level(
            llm_score=base_llm_score,
            sim_reference=float(c_feats["sim_reference"]),
            concept_coverage=float(c_feats["concept_coverage"]),
            delivery_score_or_None=deliv_score,
        )
        delta = round(score_with_delivery - score_text_only, 3)
        deltas.append(delta)

        print(
            f"{audio_path.name:<18} | {wer * 100:>5.1f}% | {deliv['speaking_rate_wpm']:>6.1f} | "
            f"{deliv['pause_frequency']:>8.2f} | {deliv['filler_count']:>7d} | "
            f"{deliv['duration_sec']:>6.1f} | {deliv_score:>8.2f} | "
            f"{score_text_only:>8.2f} | {score_with_delivery:>9.2f} | {delta:>+6.2f}"
        )

    print("-" * len(header))
    mean_wer = sum(wers) / len(wers)
    mean_abs_delta = sum(abs(d) for d in deltas) / len(deltas)
    mean_signed_delta = sum(deltas) / len(deltas)
    print(f"Samples evaluated : {len(samples)}")
    print(f"Mean WER          : {mean_wer * 100:.2f}%")
    print(f"Mean score delta  : {mean_signed_delta:+.3f} (mean |delta| = {mean_abs_delta:.3f})")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Measure Whisper WER, delivery features, and delivery-fusion score shift."
    )
    parser.add_argument("--samples-dir", type=Path, default=DEFAULT_SAMPLES_DIR)
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Skip LLM calls and compute delivery score delta against the content-score proxy.",
    )
    args = parser.parse_args()
    run_voice_eval(args.samples_dir, use_llm=not args.no_llm)


if __name__ == "__main__":
    main()
