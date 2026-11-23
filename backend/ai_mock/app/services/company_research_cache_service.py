from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import CompanyResearchCache
from app.schemas.company_research import CompanyResearchProfile, CompanyResearchRequest


def _key_part(value: str | None) -> str:
    return " ".join((value or "").casefold().split())


def research_lookup_key(request: CompanyResearchRequest) -> tuple[str, str, str]:
    return (
        _key_part(request.company_name),
        _key_part(request.target_role),
        _key_part(request.country_region),
    )


def job_description_fingerprint(request: CompanyResearchRequest) -> str | None:
    material = "\n".join(
        [
            str(request.job_description_url or ""),
            request.job_description_text or "",
        ]
    )
    if not material:
        return None
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def get_cached_research(
    db: Session,
    *,
    request: CompanyResearchRequest,
) -> CompanyResearchCache | None:
    company_key, role_key, region_key = research_lookup_key(request)
    return db.scalar(
        select(CompanyResearchCache).where(
            CompanyResearchCache.company_key == company_key,
            CompanyResearchCache.role_key == role_key,
            CompanyResearchCache.region_key == region_key,
        )
    )


def cache_matches_request(
    cached: CompanyResearchCache,
    request: CompanyResearchRequest,
) -> bool:
    return cached.job_description_fingerprint == job_description_fingerprint(request)


def cache_is_fresh(cached: CompanyResearchCache, *, now: datetime | None = None) -> bool:
    current = now or datetime.now(UTC)
    expires_at = _as_utc(cached.expires_at)
    return expires_at > current


def profile_from_cache(cached: CompanyResearchCache, *, status: str) -> CompanyResearchProfile:
    profile = CompanyResearchProfile.model_validate(json.loads(cached.profile_json))
    return profile.model_copy(
        update={
            "cache_status": status,
            "cache_expires_at": _as_utc(cached.expires_at),
            "researched_at": _as_utc(cached.researched_at),
        }
    )


def save_research_cache(
    db: Session,
    *,
    request: CompanyResearchRequest,
    profile: CompanyResearchProfile,
    settings: Settings,
    now: datetime | None = None,
) -> CompanyResearchCache:
    current = now or datetime.now(UTC)
    company_key, role_key, region_key = research_lookup_key(request)
    cached = db.scalar(
        select(CompanyResearchCache).where(
            CompanyResearchCache.company_key == company_key,
            CompanyResearchCache.role_key == role_key,
            CompanyResearchCache.region_key == region_key,
        )
    )
    expires_at = current + timedelta(hours=max(1, settings.company_research_cache_ttl_hours))
    profile_to_store = profile.model_copy(
        update={"cache_status": "live", "cache_expires_at": expires_at}
    )
    values = {
        "company_key": company_key,
        "role_key": role_key,
        "region_key": region_key,
        "company_name": request.company_name,
        "target_role": request.target_role,
        "country_region": request.country_region,
        "job_description_fingerprint": job_description_fingerprint(request),
        "profile_json": profile_to_store.model_dump_json(),
        "researched_at": profile.researched_at,
        "expires_at": expires_at,
    }
    if cached is None:
        cached = CompanyResearchCache(**values)
        db.add(cached)
    else:
        for field, value in values.items():
            setattr(cached, field, value)
    db.flush()
    return cached


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
