from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.schemas.company_research import (
    CompanyResearchProfile,
    CompanyResearchRequest,
    ResearchSource,
)
from app.services.company_research_cache_service import (
    cache_is_fresh,
    cache_matches_request,
    get_cached_research,
    profile_from_cache,
    save_research_cache,
)
from app.services.company_search_provider import SearchProviderError


def cache_settings(ttl=24):
    return SimpleNamespace(company_research_cache_ttl_hours=ttl)


def profile(timestamp=None):
    return CompanyResearchProfile(
        company_name="Acme",
        target_role="Backend Engineer",
        key_skills=["python"],
        sources=[
            ResearchSource(
                title="Acme Careers",
                url="https://example.com/careers",
                source_type="official_careers",
                retrieved_at=timestamp or datetime.now(UTC),
                evidence_strength="high",
            )
        ],
        retrieval_method="mock+bounded_public_page_extraction",
        researched_at=timestamp or datetime.now(UTC),
    )


def request(text=None, role="Backend Engineer"):
    return CompanyResearchRequest(
        company_name=" Acme ",
        target_role=role,
        country_region="US",
        job_description_text=text,
    )


def test_persists_profile_and_preserves_sources(db_session):
    current = datetime.now(UTC)
    saved = save_research_cache(
        db_session,
        request=request("Python required"),
        profile=profile(current),
        settings=cache_settings(),
        now=current,
    )
    db_session.commit()

    cached = get_cached_research(db_session, request=request("Python required"))
    restored = profile_from_cache(cached, status="cached")

    assert saved.id is not None
    assert restored.key_skills == ["python"]
    assert restored.sources[0].title == "Acme Careers"
    assert restored.sources[0].source_type == "official_careers"
    assert restored.researched_at == current


def test_cache_hit_is_fresh_and_matches_description(db_session):
    current = datetime.now(UTC)
    save_research_cache(
        db_session,
        request=request("Python required"),
        profile=profile(current),
        settings=cache_settings(ttl=2),
        now=current,
    )
    db_session.commit()
    cached = get_cached_research(db_session, request=request("Python required"))

    assert cache_is_fresh(cached, now=current + timedelta(hours=1))
    assert cache_matches_request(cached, request("Python required"))


def test_cache_expiration_is_detected(db_session):
    current = datetime.now(UTC)
    save_research_cache(
        db_session,
        request=request(),
        profile=profile(current),
        settings=cache_settings(ttl=1),
        now=current,
    )
    db_session.commit()
    cached = get_cached_research(db_session, request=request())

    assert not cache_is_fresh(cached, now=current + timedelta(hours=2))


def test_changed_job_description_invalidates_cache_key(db_session):
    current = datetime.now(UTC)
    save_research_cache(
        db_session,
        request=request("Python required"),
        profile=profile(current),
        settings=cache_settings(),
        now=current,
    )
    db_session.commit()
    cached = get_cached_research(db_session, request=request("Python required"))

    assert not cache_matches_request(cached, request("Go required"))


def test_role_is_part_of_cache_key(db_session):
    current = datetime.now(UTC)
    save_research_cache(
        db_session,
        request=request(role="Backend Engineer"),
        profile=profile(current),
        settings=cache_settings(),
        now=current,
    )
    db_session.commit()

    assert get_cached_research(
        db_session,
        request=request(role="Frontend Engineer"),
    ) is None


def _auth_headers(client, email="cache@example.com"):
    payload = {"email": email, "password": "Correct Horse Battery Staple"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post("/api/v1/auth/login", json=payload).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_endpoint_cache_hit_skips_live_research(client, db_session, monkeypatch):
    headers = _auth_headers(client)
    request_payload = {"company_name": "Acme", "target_role": "Backend Engineer"}
    timestamp = datetime.now(UTC)
    cached_profile = profile(timestamp)
    save_research_cache(
        db_session,
        request=CompanyResearchRequest(**request_payload),
        profile=cached_profile,
        settings=cache_settings(),
        now=timestamp,
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.api.routes.company_research.research_company",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("unexpected live call")),
    )
    monkeypatch.setattr(
        "app.api.routes.company_research.get_settings",
        lambda: cache_settings(),
    )
    response = client.post("/api/v1/company-research", json=request_payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["cache_status"] == "cached"
    assert response.json()["sources"][0]["title"] == "Acme Careers"


def test_endpoint_force_refresh_replaces_cache(client, db_session, monkeypatch):
    headers = _auth_headers(client, "refresh@example.com")
    request_payload = {"company_name": "Acme", "target_role": "Backend Engineer"}
    timestamp = datetime.now(UTC)
    save_research_cache(
        db_session,
        request=CompanyResearchRequest(**request_payload),
        profile=profile(timestamp),
        settings=cache_settings(),
        now=timestamp,
    )
    db_session.commit()
    refreshed = profile(timestamp + timedelta(minutes=1)).model_copy(
        update={"key_skills": ["python", "kafka"]}
    )
    monkeypatch.setattr(
        "app.api.routes.company_research.research_company",
        lambda *args, **kwargs: refreshed,
    )
    monkeypatch.setattr(
        "app.api.routes.company_research.get_settings",
        lambda: cache_settings(),
    )

    response = client.post(
        "/api/v1/company-research?refresh=true",
        json=request_payload,
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["cache_status"] == "live"
    assert response.json()["key_skills"] == ["python", "kafka"]


def test_endpoint_returns_stale_cache_when_live_provider_fails(
    client,
    db_session,
    monkeypatch,
):
    headers = _auth_headers(client, "stale@example.com")
    request_payload = {"company_name": "Acme", "target_role": "Backend Engineer"}
    timestamp = datetime.now(UTC) - timedelta(hours=2)
    save_research_cache(
        db_session,
        request=CompanyResearchRequest(**request_payload),
        profile=profile(timestamp),
        settings=cache_settings(ttl=1),
        now=timestamp,
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.api.routes.company_research.research_company",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            SearchProviderError("offline")
        ),
    )
    monkeypatch.setattr(
        "app.api.routes.company_research.get_settings",
        lambda: cache_settings(ttl=1),
    )

    response = client.post(
        "/api/v1/company-research?refresh=true",
        json=request_payload,
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["cache_status"] == "stale"
    assert "may be stale" in response.json()["limitations"][-1]
    assert response.json()["researched_at"].startswith(timestamp.isoformat()[:19])
