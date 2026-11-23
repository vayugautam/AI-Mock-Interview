from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.dependencies import get_database_session
from app.models import User
from app.schemas.dashboard import DashboardProgressResponse, DashboardSummaryResponse
from app.services.dashboard_service import get_dashboard_progress, get_dashboard_summary

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_summary(
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> DashboardSummaryResponse:
    return get_dashboard_summary(db, user_id=current_user.id)


@router.get("/progress", response_model=DashboardProgressResponse)
def get_progress(
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> DashboardProgressResponse:
    return get_dashboard_progress(db, user_id=current_user.id)
