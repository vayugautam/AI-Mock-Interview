from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field


class StoredEvaluationResponse(BaseModel):
    id: int
    correctness_score: Decimal
    relevance_score: Decimal
    clarity_score: Decimal
    completeness_score: Decimal
    overall_score: Decimal
    feedback: str
    created_at: datetime
    reasoning: str | None = None
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    missing_concepts: list[str] = Field(default_factory=list)
    improvement_suggestions: list[str] = Field(default_factory=list)
    is_off_topic: bool = False
    provider: str | None = None
    model: str | None = None


class QuestionResultResponse(BaseModel):
    id: int
    sequence_number: int
    question_text: str
    answer_id: int | None = None
    answer_text: str | None = None
    answered_at: datetime | None = None
    evaluation: StoredEvaluationResponse | None = None
    topic: str | None = None
    difficulty: str | None = None
    category: str | None = None
    source_type: str | None = None
    source_references: list[str] = Field(default_factory=list)


class InterviewResultsResponse(BaseModel):
    id: int
    role: str
    difficulty: Literal["beginner", "intermediate", "advanced"]
    interview_type: Literal["technical", "behavioral", "mixed"]
    status: str
    questions: list[QuestionResultResponse]
