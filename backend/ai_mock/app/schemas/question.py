from typing import Literal

import json

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QuestionGenerationRequest(BaseModel):
    number_of_questions: int | None = Field(default=None, ge=1, le=10)


class QuestionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    question_text: str
    sequence_number: int
    topic: str | None = None
    difficulty: str | None = None
    category: str | None = None
    source_type: str | None = None
    source_references: list[str] = Field(default_factory=list)
    model_answer: str | None = None

    @field_validator("source_references", mode="before")
    @classmethod
    def parse_source_references(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return []
            return parsed if isinstance(parsed, list) else []
        return value


class QuestionCollectionResponse(BaseModel):
    generation_source: str
    questions: list[QuestionResponse]
