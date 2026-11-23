from types import SimpleNamespace

import httpx
import pytest

from app.services.company_search_provider import (
    SearchProviderError,
    TavilySearchProvider,
    get_search_provider,
)


def test_tavily_maps_bounded_results_without_exposing_key(monkeypatch):
    captured = {}

    def fake_post(url, **kwargs):
        captured.update(kwargs)
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "Official role", "url": "https://example.com/job", "content": "Python"},
                    {"title": "Second", "url": "https://example.com/second", "content": "Systems"},
                ],
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr("app.services.company_search_provider.httpx.post", fake_post)
    provider = TavilySearchProvider("secret-key", max_retries=0)

    results = provider.search("Acme backend engineer", limit=1)

    assert len(results) == 1
    assert results[0].url == "https://example.com/job"
    assert captured["json"]["max_results"] == 1
    assert captured["json"]["api_key"] == "secret-key"


def test_tavily_provider_errors_are_normalized(monkeypatch):
    def fake_post(*args, **kwargs):
        raise httpx.TimeoutException("timed out")

    monkeypatch.setattr("app.services.company_search_provider.httpx.post", fake_post)

    with pytest.raises(SearchProviderError):
        TavilySearchProvider("secret-key", max_retries=0).search("query", limit=2)


def test_tavily_requires_server_configuration():
    with pytest.raises(RuntimeError, match="TAVILY_API_KEY"):
        TavilySearchProvider("")


def test_provider_factory_selects_tavily():
    provider = get_search_provider(
        SimpleNamespace(
            company_search_provider="tavily",
            tavily_api_key="configured",
            tavily_search_depth="advanced",
            tavily_max_results=8,
            company_research_timeout_seconds=1,
            company_research_max_retries=0,
        )
    )
    assert provider.provider_name == "tavily"
