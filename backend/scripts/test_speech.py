"""CLI smoke test for the speech pipeline: preprocess -> transcribe -> clean -> delivery features.

Usage (from backend/):
    python -m scripts.test_speech sample.webm
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.speech import (
    clean_transcript,
    delivery_features,
    get_audio_duration_sec,
    preprocess_audio,
    transcribe,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run audio preprocessing, Whisper transcription, and delivery feature extraction."
    )
    parser.add_argument(
        "audio_path",
        help="Path to input audio file (e.g. sample.webm or sample.wav)",
    )
    args = parser.parse_args()

    processed_wav = preprocess_audio(args.audio_path)
    duration_sec = get_audio_duration_sec(processed_wav)
    result = transcribe(processed_wav)

    raw_text = result["text"]
    words = result["words"]
    cleaned_text = clean_transcript(raw_text)
    features = delivery_features(words, duration_sec, raw_text=raw_text)

    print(f"Processed WAV: {processed_wav} ({duration_sec:.2f} s)\n")
    print("=== RAW TRANSCRIPT ===")
    print(raw_text or "(empty)")
    print("\n=== CLEANED TRANSCRIPT ===")
    print(cleaned_text or "(empty)")
    print("\n=== DELIVERY FEATURES (communication indicators only) ===")
    print(json.dumps(features, indent=2))


if __name__ == "__main__":
    main()
