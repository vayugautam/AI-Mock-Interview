from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AnswerCreate(BaseModel):
    answer_text: str = Field(min_length=1, max_length=10000)

    @field_validator("answer_text")
    @classmethod
    def reject_blank_answer(cls, value: str) -> str:
        normalized_value = value.strip()
        if not normalized_value:
            raise ValueError("Answer text must not be blank")
        return normalized_value


class AnswerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    question_id: int
    answer_text: str
    created_at: datetime


class AnswerCollectionResponse(BaseModel):
    answers: list[AnswerResponse]
