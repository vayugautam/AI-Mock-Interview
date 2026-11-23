from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator


Score = Decimal


class EvaluationCriteria(BaseModel):
    correctness_score: Score = Field(ge=0, le=10, max_digits=4, decimal_places=2)
    relevance_score: Score = Field(ge=0, le=10, max_digits=4, decimal_places=2)
    clarity_score: Score = Field(ge=0, le=10, max_digits=4, decimal_places=2)
    completeness_score: Score = Field(ge=0, le=10, max_digits=4, decimal_places=2)
    reasoning: str = Field(default="", max_length=2000)
    strengths: list[str] = Field(default_factory=list, max_length=10)
    weaknesses: list[str] = Field(default_factory=list, max_length=10)
    missing_concepts: list[str] = Field(default_factory=list, max_length=20)
    improvement_suggestions: list[str] = Field(default_factory=list, max_length=10)
    is_off_topic: bool = False
    feedback: str = Field(default="", max_length=5000)

    @field_validator(
        "strengths",
        "weaknesses",
        "missing_concepts",
        "improvement_suggestions",
        mode="before",
    )
    @classmethod
    def normalize_feedback_lists(cls, value: object) -> object:
        if value is None:
            return []
        return value


class EvaluationMetadata(BaseModel):
    provider: str
    is_ai_generated: bool
    scoring_method: str
    model: str | None = None


class EvaluationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    answer_id: int
    correctness_score: Score
    relevance_score: Score
    clarity_score: Score
    completeness_score: Score
    overall_score: Score
    feedback: str
    created_at: datetime
    metadata: EvaluationMetadata
    reasoning: str | None = None
    strengths: list[str] = Field(default_factory=list)
    weaknesses: list[str] = Field(default_factory=list)
    missing_concepts: list[str] = Field(default_factory=list)
    improvement_suggestions: list[str] = Field(default_factory=list)
    is_off_topic: bool = False
