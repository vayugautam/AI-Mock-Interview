from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    answer_id: Mapped[int] = mapped_column(ForeignKey("answers.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    correctness_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    relevance_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    clarity_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    completeness_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    overall_score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    feedback: Mapped[str] = mapped_column(String(5000), nullable=False)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    strengths: Mapped[str | None] = mapped_column(Text, nullable=True)
    weaknesses: Mapped[str | None] = mapped_column(Text, nullable=True)
    missing_concepts: Mapped[str | None] = mapped_column(Text, nullable=True)
    improvement_suggestions: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_off_topic: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    answer: Mapped["Answer"] = relationship(back_populates="evaluation")
