from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


Difficulty = Literal["beginner", "intermediate", "advanced"]
InterviewType = Literal["technical", "behavioral", "mixed"]


class InterviewSessionCreate(BaseModel):
    role: str = Field(min_length=2, max_length=120)
    difficulty: Difficulty
    interview_type: InterviewType
    resume_id: int | None = Field(default=None, ge=1)
    company_name: str | None = Field(default=None, min_length=2, max_length=200)
    country_region: str | None = Field(default=None, max_length=100)
    job_description_url: HttpUrl | None = None
    job_description_text: str | None = Field(default=None, max_length=30000)
    number_of_questions: int = Field(default=5, ge=1, le=10)

    @field_validator("role", "company_name", "country_region", mode="before")
    @classmethod
    def normalize_role(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class InterviewSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    role: str
    difficulty: Difficulty
    interview_type: InterviewType
    status: str
    created_at: datetime
    resume_id: int | None = None
    company_name: str | None = None
    country_region: str | None = None
    job_description_url: str | None = None
    number_of_questions: int = 5


class InterviewStatusResponse(BaseModel):
    id: int
    status: str


class InterviewCompletionResponse(InterviewStatusResponse):
    already_completed: bool
