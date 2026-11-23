"""Pydantic v2 request and response schemas for authentication and sessions."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------


class UserRegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=72)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: EmailStr
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------------------------------------------------------------------------
# Interview Session schemas
# ---------------------------------------------------------------------------


InterviewType = Literal["technical", "behavioural"]
DifficultyLevel = Literal["easy", "medium", "hard"]
SessionStatus = Literal["in_progress", "completed"]


class SessionCreateRequest(BaseModel):
    role: str = Field(..., min_length=2, max_length=120)
    experience_level: str = Field(..., min_length=2, max_length=60)
    interview_type: InterviewType
    difficulty: DifficultyLevel
    total_questions: int = Field(..., ge=3, le=10)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role: str
    experience_level: str
    interview_type: InterviewType
    difficulty: DifficultyLevel
    total_questions: int
    status: SessionStatus
    overall_score: Optional[float] = None
    band: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    order_no: int
    text: str
    topic: str
    type: InterviewType
    difficulty: DifficultyLevel
    expected_concepts: list[str]


InputMode = Literal["text", "voice"]


class EvaluationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    response_id: int
    rubric_type: InterviewType
    scores: dict[str, float]
    concepts_covered: list[str]
    llm_score: float
    similarity_score: float
    delivery_score: Optional[float] = None
    fused_score: float
    fusion_method: str
    method_scores: dict[str, float] = Field(default_factory=dict)
    eval_version: str
    created_at: datetime


class ResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question_id: int
    input_mode: InputMode
    raw_text: str
    cleaned_text: str
    audio_path: Optional[str] = None
    duration_sec: Optional[float] = None
    delivery_features: Optional[dict[str, Any]] = None
    content_features: dict[str, Any] = Field(default_factory=dict)
    evaluation: Optional[EvaluationOut] = None


class QuestionResultOut(BaseModel):
    question_id: int
    order_no: int
    question: str
    topic: str
    input_mode: InputMode
    scores: dict[str, float]
    answer_score: float
    concepts_covered: list[str]
    concepts_missing: list[str]
    method_scores: dict[str, float] = Field(default_factory=dict)


class SessionResultOut(BaseModel):
    session_id: int
    role: str
    interview_type: InterviewType
    difficulty: DifficultyLevel
    status: SessionStatus
    fusion_method: str
    session_score: float
    band: str
    completed_at: Optional[datetime] = None
    questions: list[QuestionResultOut]
