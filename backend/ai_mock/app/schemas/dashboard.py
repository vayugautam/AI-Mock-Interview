from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel


class RecentInterviewResponse(BaseModel):
    id: int
    role: str
    difficulty: Literal["beginner", "intermediate", "advanced"]
    interview_type: Literal["technical", "behavioral", "mixed"]
    status: str
    created_at: datetime


class DashboardSummaryResponse(BaseModel):
    total_interviews: int
    completed_interviews: int
    in_progress_interviews: int
    total_answered_questions: int
    average_overall_score: Decimal | None
    recent_interviews: list[RecentInterviewResponse]


class PerformanceHistoryItem(BaseModel):
    evaluated_at: datetime | None
    session_id: int
    answer_id: int
    correctness_score: Decimal
    relevance_score: Decimal
    clarity_score: Decimal
    completeness_score: Decimal
    overall_score: Decimal


class DashboardProgressResponse(BaseModel):
    progress: list[PerformanceHistoryItem]
