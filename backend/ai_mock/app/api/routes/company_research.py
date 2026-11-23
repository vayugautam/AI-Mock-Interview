import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.models import User
from app.schemas.company_research import CompanyResearchProfile, CompanyResearchRequest
from app.services.company_research_service import research_company
from app.core.config import get_settings
from app.db.dependencies import get_database_session
from app.services.company_research_cache_service import (
    cache_is_fresh,
    cache_matches_request,
    get_cached_research,
    profile_from_cache,
    save_research_cache,
)
from app.services.company_search_provider import SearchProviderError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/company-research", tags=["company-research"])


@router.post("", response_model=CompanyResearchProfile)
def research_company_endpoint(
    request: CompanyResearchRequest,
    refresh: bool = Query(default=False),
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> CompanyResearchProfile:
    settings = get_settings()
    cached = get_cached_research(db, request=request)
    if cached and not refresh and cache_matches_request(cached, request) and cache_is_fresh(cached):
        return profile_from_cache(cached, status="cached")
    try:
        profile = research_company(request, settings=settings)
        if profile.sources:
            saved = save_research_cache(
                db,
                request=request,
                profile=profile,
                settings=settings,
            )
            db.commit()
            return profile.model_copy(
                update={"cache_status": "live", "cache_expires_at": saved.expires_at}
            )
        if cached and cache_matches_request(cached, request):
            stale_profile = profile_from_cache(cached, status="stale")
            return stale_profile.model_copy(
                update={
                    "limitations": [
                        *stale_profile.limitations,
                        "Live research failed; cached results may be stale.",
                    ]
                }
            )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No reliable company research is currently available",
        )
    except SearchProviderError as exc:
        if cached and cache_matches_request(cached, request):
            stale_profile = profile_from_cache(cached, status="stale")
            return stale_profile.model_copy(
                update={
                    "limitations": [
                        *stale_profile.limitations,
                        "Live research failed; cached results may be stale.",
                    ]
                }
            )
        logger.warning("Company research provider unavailable for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Company research is temporarily unavailable",
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to persist company research for user %s", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to save company research",
        ) from exc
    except RuntimeError as exc:
        if cached and cache_matches_request(cached, request):
            stale_profile = profile_from_cache(cached, status="stale")
            return stale_profile.model_copy(
                update={
                    "limitations": [
                        *stale_profile.limitations,
                        "Live research failed; cached results may be stale.",
                    ]
                }
            )
        logger.error("Company research provider configuration is invalid")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Company research is not configured",
        ) from exc
