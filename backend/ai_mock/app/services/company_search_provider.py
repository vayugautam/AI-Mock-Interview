from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote_plus

import httpx


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str


class SearchProvider(Protocol):
    provider_name: str

    def search(self, query: str, *, limit: int) -> list[SearchResult]:
        """Return bounded public search results for a query."""


class SearchProviderError(Exception):
    """Raised when a configured search provider cannot complete a request."""


class TavilySearchProvider:
    """Server-side Tavily search adapter with bounded, structured results."""

    provider_name = "tavily"

    def __init__(
        self,
        api_key: str,
        *,
        timeout_seconds: float = 8.0,
        max_retries: int = 1,
        search_depth: str = "advanced",
        max_results: int = 8,
    ):
        if not api_key.strip():
            raise RuntimeError("TAVILY_API_KEY is required when COMPANY_SEARCH_PROVIDER is tavily")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, max_retries)
        self.search_depth = search_depth if search_depth in {"basic", "advanced"} else "advanced"
        self.max_results = max(1, min(max_results, 10))

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]:
        bounded_limit = max(1, min(limit, self.max_results))
        payload = {
            "api_key": self.api_key,
            "query": query[:500],
            "search_depth": self.search_depth,
            "max_results": bounded_limit,
            "include_answer": False,
            "include_raw_content": False,
        }
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = httpx.post(
                    "https://api.tavily.com/search",
                    json=payload,
                    headers={"Accept": "application/json"},
                    timeout=self.timeout_seconds,
                )
                response.raise_for_status()
                data = response.json()
                raw_results = data.get("results")
                if not isinstance(raw_results, list):
                    raise ValueError("Tavily response did not contain results")
                return [
                    SearchResult(
                        title=str(item.get("title") or item.get("url") or "Untitled source"),
                        url=str(item["url"]),
                        snippet=str(item.get("content") or "")[:2000],
                    )
                    for item in raw_results[:bounded_limit]
                    if isinstance(item, dict) and item.get("url")
                ]
            except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
        raise SearchProviderError("Tavily company search is temporarily unavailable") from last_error


class DuckDuckGoHtmlSearchProvider:
    """Bounded DuckDuckGo HTML search provider requiring no application key."""

    provider_name = "duckduckgo_html"

    def __init__(
        self,
        *,
        timeout_seconds: float = 8.0,
        max_retries: int = 1,
        user_agent: str = "AI-Mock-Interview-Platform/1.0",
        max_response_bytes: int = 100000,
    ):
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, max_retries)
        self.user_agent = user_agent
        self.max_response_bytes = max(1, max_response_bytes)

    def search(self, query: str, *, limit: int = 5) -> list[SearchResult]:
        from app.services.company_page_service import extract_search_results

        bounded_limit = max(1, min(limit, 10))
        url = f"https://html.duckduckgo.com/html/?q={quote_plus(query[:500])}"
        last_error: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                response = httpx.get(
                    url,
                    headers={"User-Agent": self.user_agent},
                    timeout=self.timeout_seconds,
                    follow_redirects=False,
                )
                response.raise_for_status()
                return extract_search_results(
                    response.content[: self.max_response_bytes].decode(
                        response.encoding or "utf-8",
                        errors="replace",
                    ),
                    limit=bounded_limit,
                )
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
        raise SearchProviderError("Public company search is temporarily unavailable") from last_error


def get_search_provider(settings) -> SearchProvider:
    if settings.company_search_provider.lower() == "tavily":
        return TavilySearchProvider(
            settings.tavily_api_key or "",
            timeout_seconds=settings.company_research_timeout_seconds,
            max_retries=settings.company_research_max_retries,
            search_depth=settings.tavily_search_depth,
            max_results=settings.tavily_max_results,
        )
    if settings.company_search_provider.lower() == "duckduckgo_html":
        return DuckDuckGoHtmlSearchProvider(
            timeout_seconds=settings.company_research_timeout_seconds,
            max_retries=settings.company_research_max_retries,
            user_agent=settings.company_research_user_agent,
            max_response_bytes=settings.company_research_max_search_content_bytes,
        )
    raise RuntimeError("COMPANY_SEARCH_PROVIDER must be duckduckgo_html or a custom provider")
