"""Single centralized LLM client module (`call_llm_json`) for provider-swappable JSON calls."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_CODE_FENCE_RE = re.compile(
    r"^\s*```(?:json)?\s*\n?(.*?)\n?\s*```\s*$",
    re.DOTALL | re.IGNORECASE,
)


class LLMError(Exception):
    """Raised when the LLM provider fails or returns invalid JSON after retries."""


def strip_json_fences(raw_text: str) -> str:
    """Remove optional ```json ... ``` markdown fences around an LLM response."""
    cleaned = raw_text.strip()
    match = _CODE_FENCE_RE.match(cleaned)
    if match:
        return match.group(1).strip()
    return cleaned


def _request_provider_completion(
    system: str,
    user: str,
    temperature: float,
) -> str:
    """Send a chat-completion request to the configured OpenAI-compatible LLM provider.

    Swap providers (Groq, OpenAI, OpenRouter, Together, local Ollama) by changing
    `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` in `.env`.
    """
    if not settings.LLM_API_KEY:
        raise LLMError("LLM_API_KEY is not configured in .env")
    if not settings.LLM_MODEL:
        raise LLMError("LLM_MODEL is not configured in .env")

    endpoint = f"{settings.LLM_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.LLM_API_KEY}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": settings.LLM_MODEL,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(endpoint, headers=headers, json=payload)
            # Some providers/models do not accept response_format; retry once without it
            if response.status_code == 400 and "response_format" in response.text:
                payload.pop("response_format", None)
                response = client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise LLMError(f"LLM HTTP request failed: {exc}") from exc
    except ValueError as exc:
        raise LLMError(f"LLM provider returned non-JSON HTTP envelope: {exc}") from exc

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError("Unexpected LLM response structure: missing choices[0].message.content") from exc

    if not isinstance(content, str) or not content.strip():
        raise LLMError("LLM returned empty content")
    return content


def call_llm_json(
    system: str,
    user: str,
    temperature: float = 0.0,
    max_retries: int = 2,
) -> dict[str, Any]:
    """Call the configured LLM provider and return a parsed JSON object.

    Requests JSON-only output, strips markdown ```json fences, parses with
    `json.loads`, retries up to `max_retries` times on invalid JSON, and raises
    `LLMError` afterwards.
    """
    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        prompt_user = (
            user
            if attempt == 0
            else (
                f"{user}\n\n"
                "Your previous response was not valid JSON. Return ONLY a raw JSON object."
            )
        )
        raw_text = _request_provider_completion(
            system=system,
            user=prompt_user,
            temperature=temperature,
        )
        cleaned = strip_json_fences(raw_text)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as exc:
            last_error = exc
            logger.warning(
                "call_llm_json received invalid JSON on attempt %d/%d: %s",
                attempt + 1,
                max_retries + 1,
                exc,
            )
            continue

        if not isinstance(parsed, dict):
            last_error = TypeError(f"Expected JSON object, got {type(parsed).__name__}")
            logger.warning(
                "call_llm_json received non-object JSON on attempt %d/%d",
                attempt + 1,
                max_retries + 1,
            )
            continue

        return parsed

    raise LLMError(
        f"LLM failed to return valid JSON after {max_retries + 1} attempts: {last_error}"
    )
