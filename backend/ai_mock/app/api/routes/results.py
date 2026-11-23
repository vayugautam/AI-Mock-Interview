from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.routes.auth import get_current_user
from app.db.dependencies import get_database_session
from app.models import User
from app.schemas.results import InterviewResultsResponse
from app.services.results_service import get_interview_results

router = APIRouter(prefix="/interviews", tags=["results"])


@router.get("/{session_id}/results", response_model=InterviewResultsResponse)
def get_results(
    session_id: int,
    db: Session = Depends(get_database_session),
    current_user: User = Depends(get_current_user),
) -> InterviewResultsResponse:
    try:
        results = get_interview_results(db, user_id=current_user.id, session_id=session_id)
    except OperationalError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is temporarily unavailable. Please retry shortly.",
        ) from exc
    if results is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Interview session not found",
        )
    return results
