"""SQLAlchemy 2.x ORM models for users, interviews, responses, and evaluations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    profile: Mapped[Optional["CandidateProfile"]] = relationship(
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
    )
    sessions: Mapped[list["InterviewSession"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"

    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    target_role: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    skills: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    experience_level: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)

    user: Mapped["User"] = relationship(back_populates="profile")


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('in_progress', 'completed')",
            name="ck_interview_sessions_status",
        ),
        CheckConstraint(
            "interview_type IN ('technical', 'behavioural')",
            name="ck_interview_sessions_type",
        ),
        CheckConstraint(
            "difficulty IN ('easy', 'medium', 'hard')",
            name="ck_interview_sessions_difficulty",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    experience_level: Mapped[str] = mapped_column(String(60), nullable=False)
    interview_type: Mapped[str] = mapped_column(String(20), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="in_progress", nullable=False)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    band: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="sessions")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Question.order_no",
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    order_no: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    topic: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    expected_concepts: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    session: Mapped["InterviewSession"] = relationship(back_populates="questions")
    response: Mapped[Optional["Response"]] = relationship(
        back_populates="question",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Response(Base):
    __tablename__ = "responses"
    __table_args__ = (
        CheckConstraint(
            "input_mode IN ('text', 'voice')",
            name="ck_responses_input_mode",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    question_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("questions.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    input_mode: Mapped[str] = mapped_column(String(10), nullable=False)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    cleaned_text: Mapped[str] = mapped_column(Text, nullable=False)
    audio_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_features: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    content_features: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    question: Mapped["Question"] = relationship(back_populates="response")
    evaluation: Mapped[Optional["Evaluation"]] = relationship(
        back_populates="response",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    response_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("responses.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    rubric_type: Mapped[str] = mapped_column(String(20), nullable=False)
    scores: Mapped[dict[str, float]] = mapped_column(JSON, default=dict, nullable=False)
    concepts_covered: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    llm_score: Mapped[float] = mapped_column(Float, nullable=False)
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    delivery_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    fused_score: Mapped[float] = mapped_column(Float, nullable=False)
    fusion_method: Mapped[str] = mapped_column(String(40), nullable=False)
    method_scores: Mapped[dict[str, float]] = mapped_column(JSON, default=dict, nullable=False)
    eval_version: Mapped[str] = mapped_column(String(20), default="eval-v1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    response: Mapped["Response"] = relationship(back_populates="evaluation")
