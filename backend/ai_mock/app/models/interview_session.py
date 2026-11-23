from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    resume_id: Mapped[int | None] = mapped_column(
        ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(30), nullable=False)
    interview_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    country_region: Mapped[str | None] = mapped_column(String(100), nullable=True)
    job_description_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    job_description_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_description_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped["User"] = relationship(back_populates="interview_sessions")
    resume: Mapped["Resume | None"] = relationship()
    questions: Mapped[list["Question"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    answers: Mapped[list["Answer"]] = relationship(back_populates="session", cascade="all, delete-orphan")
