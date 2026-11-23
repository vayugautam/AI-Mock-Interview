from datetime import datetime

from sqlalchemy import DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CompanyResearchCache(Base):
    __tablename__ = "company_research_cache"
    __table_args__ = (
        UniqueConstraint(
            "company_key",
            "role_key",
            "region_key",
            name="uq_company_research_cache_lookup",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    company_key: Mapped[str] = mapped_column(String(200), nullable=False)
    role_key: Mapped[str] = mapped_column(String(160), nullable=False)
    region_key: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    target_role: Mapped[str] = mapped_column(String(160), nullable=False)
    country_region: Mapped[str | None] = mapped_column(String(100), nullable=True)
    job_description_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    profile_json: Mapped[str] = mapped_column(Text, nullable=False)
    researched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
