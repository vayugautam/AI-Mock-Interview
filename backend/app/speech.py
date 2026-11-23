"""Audio preprocessing, Whisper transcription, filler cleaning, and delivery-feature extraction.

Delivery features (speaking rate, pause frequency, filler count, duration) are
computed strictly as communication delivery indicators.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from app.config import settings

logger = logging.getLogger(__name__)

TARGET_SAMPLE_RATE = 16_000
SILENCE_TRIM_TOP_DB = 30
LONG_PAUSE_THRESHOLD_SEC = 0.6

# Normalized scoring range documentation (all normalized values in [0.0, 1.0]):
# - speaking_rate_wpm: 90-180 WPM -> 1.0; ramps from 30->90 and decays 180->260 WPM.
# - pause_frequency:   0-2 pauses(>0.6s)/min -> 1.0; decays linearly to 0.0 at >= 12/min.
# - filler_count:      based on fillers per 100 words; <= 1.0/100w -> 1.0, >= 15.0/100w -> 0.0.
# - duration_sec:      30-180 s -> 1.0; ramps 0->30 s and decays gently above 180 s.
IDEAL_WPM_MIN = 90.0
IDEAL_WPM_MAX = 180.0
MIN_WPM_FLOOR = 30.0
MAX_WPM_CEIL = 260.0

IDEAL_PAUSE_FREQ_MAX = 2.0
MAX_PAUSE_FREQ_CEIL = 12.0

IDEAL_FILLER_PER_100W = 1.0
MAX_FILLER_PER_100W = 15.0

IDEAL_DURATION_MIN = 30.0
IDEAL_DURATION_MAX = 180.0
MAX_DURATION_CEIL = 360.0


class AudioProcessingError(Exception):
    """Raised when audio decoding, preprocessing, or transcription fails."""


# ---------------------------------------------------------------------------
# 1. Audio preprocessing (16 kHz mono, silence trim, peak normalisation)
# ---------------------------------------------------------------------------


def _convert_to_wav_with_ffmpeg(src_path: Path, dst_wav: Path) -> None:
    """Decode arbitrary containers (e.g. .webm, .m4a, .ogg) to 16 kHz mono PCM WAV."""
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise AudioProcessingError(
            "ffmpeg is not installed or not on PATH. Install ffmpeg to decode webm/compressed audio."
        )

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i",
        str(src_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(TARGET_SAMPLE_RATE),
        "-f",
        "wav",
        str(dst_wav),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise AudioProcessingError("ffmpeg timed out while decoding audio.") from exc
    except OSError as exc:
        raise AudioProcessingError(f"Failed to invoke ffmpeg: {exc}") from exc

    if proc.returncode != 0 or not dst_wav.is_file():
        stderr_snippet = (proc.stderr or "").strip()[-300:]
        raise AudioProcessingError(f"ffmpeg failed to decode audio: {stderr_snippet}")


def preprocess_audio(path: str | Path) -> str:
    """Load audio, resample to 16 kHz mono, trim leading/trailing silence (top_db=30),
    peak-normalise, and write a processed WAV file.

    Returns the file path of the processed WAV as a string.
    """
    import librosa
    import numpy as np
    import soundfile as sf

    src_path = Path(path)
    if not src_path.is_file():
        raise AudioProcessingError(f"Audio file not found: {src_path}")

    temp_wav: Optional[Path] = None
    load_target = src_path

    # Use ffmpeg for non-WAV formats (such as browser MediaRecorder .webm) or fallback
    if src_path.suffix.lower() != ".wav":
        fd, tmp_name = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        Path(tmp_name).unlink(missing_ok=True)
        temp_wav = Path(tmp_name)
        _convert_to_wav_with_ffmpeg(src_path, temp_wav)
        load_target = temp_wav

    try:
        try:
            audio, _sr = librosa.load(
                str(load_target),
                sr=TARGET_SAMPLE_RATE,
                mono=True,
            )
        except Exception:
            # If a .wav container uses an unusual codec, retry via ffmpeg
            if temp_wav is None:
                fd, tmp_name = tempfile.mkstemp(suffix=".wav")
                os.close(fd)
                Path(tmp_name).unlink(missing_ok=True)
                temp_wav = Path(tmp_name)
                _convert_to_wav_with_ffmpeg(src_path, temp_wav)
                audio, _sr = librosa.load(
                    str(temp_wav),
                    sr=TARGET_SAMPLE_RATE,
                    mono=True,
                )
            else:
                raise
    except AudioProcessingError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AudioProcessingError(f"Failed to load audio '{src_path.name}': {exc}") from exc
    finally:
        if temp_wav is not None:
            temp_wav.unlink(missing_ok=True)

    if audio is None or audio.size == 0:
        raise AudioProcessingError("Audio file contains no samples.")

    # Trim leading and trailing silence using librosa (top_db=30)
    trimmed, _ = librosa.effects.trim(audio, top_db=SILENCE_TRIM_TOP_DB)
    if trimmed.size == 0:
        trimmed = audio

    # Peak normalisation to [-1.0, 1.0] without dividing by zero on silent clips
    peak = float(np.max(np.abs(trimmed)))
    if peak > 0.0:
        normalized = (trimmed / peak).astype(np.float32)
    else:
        normalized = trimmed.astype(np.float32)

    processed_path = src_path.with_name(f"{src_path.stem}_processed.wav")
    sf.write(str(processed_path), normalized, TARGET_SAMPLE_RATE, subtype="PCM_16")
    return str(processed_path)


def get_audio_duration_sec(path: str | Path) -> float:
    """Return audio duration in seconds from a WAV file."""
    import soundfile as sf

    info = sf.info(str(path))
    if info.samplerate <= 0:
        return 0.0
    return round(float(info.frames) / float(info.samplerate), 3)


# ---------------------------------------------------------------------------
# 2. Speech-to-text transcription (faster-whisper, English, word timestamps)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def get_whisper_model():
    """Load and cache the faster-whisper model configured in settings.WHISPER_MODEL."""
    from faster_whisper import WhisperModel

    return WhisperModel(
        settings.WHISPER_MODEL,
        device="cpu",
        compute_type="int8",
    )


def transcribe(path: str | Path) -> dict[str, Any]:
    """Transcribe an audio file using faster-whisper with English word timestamps.

    Returns:
        {"text": str, "words": [{"word": str, "start": float, "end": float}]}
    """
    audio_path = Path(path)
    if not audio_path.is_file():
        raise AudioProcessingError(f"Audio file not found for transcription: {audio_path}")

    model = get_whisper_model()
    segments, _info = model.transcribe(
        str(audio_path),
        language="en",
        word_timestamps=True,
    )

    text_parts: list[str] = []
    words: list[dict[str, Any]] = []

    for segment in segments:
        seg_text = (segment.text or "").strip()
        if seg_text:
            text_parts.append(seg_text)
        if segment.words:
            for item in segment.words:
                token = (item.word or "").strip()
                if token:
                    words.append(
                        {
                            "word": token,
                            "start": round(float(item.start), 3),
                            "end": round(float(item.end), 3),
                        }
                    )

    return {
        "text": " ".join(text_parts).strip(),
        "words": words,
    }


# ---------------------------------------------------------------------------
# 3. Transcript cleaning & filler counting (raw transcript preserved by caller)
# ---------------------------------------------------------------------------

# Hesitation fillers: um/umm, uh/uhh, er/err, ah/ahh, hmm/hmmm
_SIMPLE_FILLER_RE = re.compile(
    r"(?i)(?:(?<=^)|(?<=[\s,.;:!?()\"'-]))(?:u+m+|u+h+|e+r+|a+h+|h+m+)(?:(?=[\s,.;:!?()\"'-])|(?=$))"
)

# Multi-word conversational filler "you know"
_YOU_KNOW_RE = re.compile(r"(?i)\b(?:,\s*)?you\s+know(?:\s*,)?\b")

# "like" used strictly as a verbal filler (preserves "I like Python", "tools like Docker"):
# - Repeated "like, like"
# - Sentence/clause-leading "Like, ..."
# - Comma-bracketed ", like,"
# - Preceded by filler/discourse markers ("so like,", "it's like,", "was like,", "just like,")
_FILLER_LIKE_PATTERNS = [
    re.compile(r"(?i)\blike\s*,?\s+like\b"),
    re.compile(r"(?i)(?:^|(?<=[.!?]\s))like\s*,\s+"),
    re.compile(r"(?i),\s*like\s*,"),
    re.compile(r"(?i),\s*like(?=\s+(?:a|an|the|we|i|it|they|this|that|you|to|in|when|if)\b)"),
    re.compile(r"(?i)\b(?:so|well|just|literally|was|is|it's|its|were)\s+like\s*,"),
]

_BASICALLY_RE = re.compile(r"(?i)\bbasically\b")
_REPEATED_BASICALLY_RE = re.compile(r"(?i)\bbasically(?:\s*,?\s*basically)+\b")


def count_fillers(raw_text: str) -> int:
    """Count filler tokens in a raw transcript for delivery telemetry."""
    if not raw_text:
        return 0

    count = 0
    count += len(_SIMPLE_FILLER_RE.findall(raw_text))
    count += len(_YOU_KNOW_RE.findall(raw_text))

    # Count filler-only occurrences of "like"
    working = raw_text
    for pattern in _FILLER_LIKE_PATTERNS:
        matches = pattern.findall(working)
        count += len(matches)
        working = pattern.sub(" ", working)

    # Count repeated uses of "basically" (occurrences beyond the first)
    basically_hits = _BASICALLY_RE.findall(raw_text)
    if len(basically_hits) > 1:
        count += len(basically_hits) - 1

    return count


def clean_transcript(text: str) -> str:
    """Remove spoken filler tokens for content evaluation while preserving meaning.

    Removes: um, uh, er, ah, hmm, "you know", filler uses of "like", and
    repeated occurrences of "basically". Keep raw_text separately for telemetry.
    """
    if not text or not text.strip():
        return ""

    cleaned = text

    # 1. Remove "you know"
    cleaned = _YOU_KNOW_RE.sub(" ", cleaned)

    # 2. Remove simple hesitation fillers (um, uh, er, ah, hmm)
    cleaned = _SIMPLE_FILLER_RE.sub(" ", cleaned)

    # 3. Remove filler-only uses of "like"
    cleaned = re.sub(r"(?i)\blike\s*,?\s+like\b", " ", cleaned)
    cleaned = re.sub(r"(?i)(?:^|(?<=[.!?]\s))like\s*,\s+", "", cleaned)
    cleaned = re.sub(r"(?i),\s*like\s*,", ",", cleaned)
    cleaned = re.sub(
        r"(?i),\s*like(?=\s+(?:a|an|the|we|i|it|they|this|that|you|to|in|when|if)\b)",
        ",",
        cleaned,
    )
    cleaned = re.sub(
        r"(?i)(\b(?:so|well|just|literally|was|is|it's|its|were))\s+like\s*,",
        r"\1",
        cleaned,
    )

    # 4. Collapse consecutive "basically basically" and remove repeated "basically"
    cleaned = _REPEATED_BASICALLY_RE.sub("basically", cleaned)
    basically_matches = list(_BASICALLY_RE.finditer(cleaned))
    if len(basically_matches) > 1:
        # Keep the first occurrence only if it isn't a standalone repeated filler; drop repeats
        parts: list[str] = []
        last_idx = 0
        for idx, match in enumerate(basically_matches):
            if idx == 0:
                continue
            parts.append(cleaned[last_idx : match.start()])
            last_idx = match.end()
        parts.append(cleaned[last_idx:])
        cleaned = " ".join(parts)

    # 5. Clean up leftover punctuation and whitespace artifacts
    cleaned = re.sub(r"\s+([,.;:!?])", r"\1", cleaned)
    cleaned = re.sub(r"(?:,\s*){2,}", ", ", cleaned)
    cleaned = re.sub(r",\s*([.!?])", r"\1", cleaned)
    cleaned = re.sub(r"^\s*[,;:]+\s*", "", cleaned)
    cleaned = re.sub(r"([.!?]\s*)[,;:]+\s*", r"\1", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# 4. Delivery features (communication indicators only, with 0-1 normalization)
# ---------------------------------------------------------------------------


def _clamp01(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 4)


def _normalize_wpm(wpm: float) -> float:
    """Normalize speaking rate to 0-1 (90-180 WPM ideal -> 1.0)."""
    if wpm <= MIN_WPM_FLOOR or wpm >= MAX_WPM_CEIL:
        return 0.0
    if IDEAL_WPM_MIN <= wpm <= IDEAL_WPM_MAX:
        return 1.0
    if wpm < IDEAL_WPM_MIN:
        return _clamp01((wpm - MIN_WPM_FLOOR) / (IDEAL_WPM_MIN - MIN_WPM_FLOOR))
    return _clamp01((MAX_WPM_CEIL - wpm) / (MAX_WPM_CEIL - IDEAL_WPM_MAX))


def _normalize_pause_frequency(pauses_per_min: float) -> float:
    """Normalize long-pause frequency (>0.6 s/min) to 0-1 (<=2/min -> 1.0, >=12/min -> 0.0)."""
    if pauses_per_min <= IDEAL_PAUSE_FREQ_MAX:
        return 1.0
    if pauses_per_min >= MAX_PAUSE_FREQ_CEIL:
        return 0.0
    return _clamp01(
        (MAX_PAUSE_FREQ_CEIL - pauses_per_min) / (MAX_PAUSE_FREQ_CEIL - IDEAL_PAUSE_FREQ_MAX)
    )


def _normalize_fillers(filler_count: int, word_count: int) -> float:
    """Normalize filler fluency to 0-1 (fewer fillers per 100 words -> higher)."""
    if filler_count <= 0:
        return 1.0
    denom = max(1, word_count)
    fillers_per_100w = (filler_count / denom) * 100.0
    if fillers_per_100w <= IDEAL_FILLER_PER_100W:
        return 1.0
    if fillers_per_100w >= MAX_FILLER_PER_100W:
        return 0.0
    return _clamp01(
        (MAX_FILLER_PER_100W - fillers_per_100w) / (MAX_FILLER_PER_100W - IDEAL_FILLER_PER_100W)
    )


def _normalize_duration(duration_sec: float) -> float:
    """Normalize answer duration to 0-1 (30-180 s ideal -> 1.0)."""
    if duration_sec <= 0.0:
        return 0.0
    if IDEAL_DURATION_MIN <= duration_sec <= IDEAL_DURATION_MAX:
        return 1.0
    if duration_sec < IDEAL_DURATION_MIN:
        return _clamp01(duration_sec / IDEAL_DURATION_MIN)
    if duration_sec >= MAX_DURATION_CEIL:
        return 0.2
    # Gentle decay from 1.0 at 180 s to 0.2 at 360 s
    ratio = (duration_sec - IDEAL_DURATION_MAX) / (MAX_DURATION_CEIL - IDEAL_DURATION_MAX)
    return _clamp01(1.0 - 0.8 * ratio)


def delivery_features(
    words: list[dict[str, Any]],
    duration_sec: float,
    *,
    raw_text: Optional[str] = None,
) -> dict[str, Any]:
    """Compute speech delivery communication indicators and their 0-1 normalized scores.

    Args:
        words: List of {"word", "start", "end"} dicts from Whisper.
        duration_sec: Total speech duration in seconds.
        raw_text: Optional raw transcript string; reconstructed from `words` if omitted.

    Returns:
        Dict with raw metrics (`speaking_rate_wpm`, `pause_frequency`, `filler_count`,
        `duration_sec`) and a `normalized` sub-dict with each indicator scaled to [0, 1].
    """
    transcript_for_fillers = (
        raw_text
        if raw_text is not None
        else " ".join(str(w.get("word", "")).strip() for w in words if w.get("word"))
    )

    effective_duration = float(duration_sec or 0.0)
    if effective_duration <= 0.0 and len(words) >= 2:
        start_t = float(words[0].get("start", 0.0))
        end_t = float(words[-1].get("end", start_t))
        effective_duration = max(0.0, end_t - start_t)

    duration_minutes = max(effective_duration, 1.0) / 60.0
    word_count = len(words) if words else len(transcript_for_fillers.split())

    speaking_rate_wpm = round(word_count / duration_minutes, 2) if word_count > 0 else 0.0

    # Count inter-word pauses strictly greater than 0.6 seconds
    long_pauses = 0
    for idx in range(1, len(words)):
        prev_end = float(words[idx - 1].get("end", 0.0))
        curr_start = float(words[idx].get("start", prev_end))
        if (curr_start - prev_end) > LONG_PAUSE_THRESHOLD_SEC:
            long_pauses += 1

    pause_frequency = round(long_pauses / duration_minutes, 2) if effective_duration > 0 else 0.0
    filler_count = count_fillers(transcript_for_fillers)

    return {
        "speaking_rate_wpm": speaking_rate_wpm,
        "pause_frequency": pause_frequency,
        "filler_count": filler_count,
        "duration_sec": round(effective_duration, 2),
        "normalized": {
            "speaking_rate_wpm": _normalize_wpm(speaking_rate_wpm),
            "pause_frequency": _normalize_pause_frequency(pause_frequency),
            "filler_count": _normalize_fillers(filler_count, word_count),
            "duration_sec": _normalize_duration(effective_duration),
        },
    }
