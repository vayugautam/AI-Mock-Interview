from __future__ import annotations

import html
import ipaddress
import re
import socket
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.services.company_search_provider import SearchResult

BLOCKED_HOSTNAMES = frozenset(
    {"localhost", "localhost.localdomain", "metadata.google.internal", "instance-data.ec2.internal"}
)


class UnsafeUrlError(ValueError):
    """Raised when a URL could target a private or internal network."""


class PageFetchError(Exception):
    """Raised when a public page cannot be fetched safely."""


@dataclass(frozen=True)
class PageDocument:
    title: str
    url: str
    text: str
    retrieved_at: datetime


class _TextParser(HTMLParser):
    def __init__(self, *, max_chars: int):
        super().__init__(convert_charrefs=True)
        self.max_chars = max_chars
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self._ignored_depth = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._ignored_depth += 1
        elif tag.lower() == "title" and not self._ignored_depth:
            self._in_title = True

    def handle_endtag(self, tag):
        if tag.lower() in {"script", "style", "noscript", "svg"} and self._ignored_depth:
            self._ignored_depth -= 1
        elif tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._ignored_depth:
            return
        normalized = " ".join(data.split())
        if not normalized:
            return
        if self._in_title:
            self.title_parts.append(normalized)
        if sum(len(part) for part in self.text_parts) < self.max_chars:
            self.text_parts.append(normalized[: self.max_chars])


def sanitize_public_url(value: str) -> str:
    if len(value) > 2048:
        raise UnsafeUrlError("URL is too long")
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrlError("Only public HTTP(S) URLs are supported")
    if parsed.username or parsed.password:
        raise UnsafeUrlError("URLs with embedded credentials are not supported")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname in BLOCKED_HOSTNAMES or hostname.endswith(".local"):
        raise UnsafeUrlError("Private and internal hosts are not allowed")
    try:
        address = ipaddress.ip_address(hostname)
        _ensure_public_address(address)
    except ValueError:
        try:
            addresses = {
                info[4][0]
                for info in socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
            }
        except OSError as exc:
            raise UnsafeUrlError("Unable to resolve public host") from exc
        if not addresses:
            raise UnsafeUrlError("Unable to resolve public host")
        for address in addresses:
            _ensure_public_address(ipaddress.ip_address(address))
    return urlunsplit((parsed.scheme.lower(), hostname, parsed.path, parsed.query, ""))


def _ensure_public_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    if (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    ):
        raise UnsafeUrlError("Private and internal hosts are not allowed")


def fetch_public_page(
    url: str,
    *,
    timeout_seconds: float,
    max_content_bytes: int,
    user_agent: str,
) -> PageDocument:
    safe_url = sanitize_public_url(url)
    try:
        with httpx.stream(
            "GET",
            safe_url,
            headers={"User-Agent": user_agent, "Accept": "text/html, text/plain"},
            timeout=timeout_seconds,
            follow_redirects=False,
        ) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if "text/html" not in content_type and "text/plain" not in content_type:
                raise PageFetchError("Company page did not return readable text")
            raw_buffer = bytearray()
            for chunk in response.iter_bytes():
                remaining = max_content_bytes - len(raw_buffer)
                if remaining <= 0:
                    break
                raw_buffer.extend(chunk[:remaining])
    except (httpx.HTTPError, ValueError) as exc:
        raise PageFetchError("Unable to retrieve public company page") from exc
    raw = bytes(raw_buffer)
    parser = _TextParser(max_chars=max_content_bytes)
    try:
        parser.feed(raw.decode(response.encoding or "utf-8", errors="replace"))
    except (ValueError, UnicodeError) as exc:
        raise PageFetchError("Company page content could not be parsed") from exc
    text = " ".join(parser.text_parts).strip()
    if not text:
        raise PageFetchError("Company page contained no readable text")
    return PageDocument(
        title=" ".join(parser.title_parts).strip() or safe_url,
        url=safe_url,
        text=text[:max_content_bytes],
        retrieved_at=datetime.now(UTC),
    )


def extract_search_results(content: str, *, limit: int) -> list[SearchResult]:
    # DuckDuckGo's result markup is intentionally parsed conservatively.
    matches = re.findall(
        r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?'
        r'class="result__snippet"[^>]*>(.*?)</',
        content,
        flags=re.IGNORECASE | re.DOTALL,
    )
    results: list[SearchResult] = []
    for url, title, snippet in matches[:limit]:
        results.append(
            SearchResult(
                title=re.sub(r"<[^>]+>", "", html.unescape(title)).strip(),
                url=html.unescape(url).strip(),
                snippet=re.sub(r"<[^>]+>", "", html.unescape(snippet)).strip(),
            )
        )
    return results
