from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


SourceType = Literal[
    "official_job_description",
    "official_careers",
    "official_interview_prep",
    "official_engineering",
    "candidate_report",
    "other_public_source",
    "user_supplied_job_description",
]
EvidenceKind = Literal["verified", "inference", "anecdotal"]
EvidenceStrength = Literal["high", "medium", "low"]


class CompanyResearchRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=200)
    target_role: str = Field(min_length=2, max_length=160)
    country_region: str | None = Field(default=None, max_length=100)
    job_description_url: HttpUrl | None = None
    job_description_text: str | None = Field(default=None, max_length=30000)

    @field_validator("company_name", "target_role", "country_region", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if isinstance(value, str):
            return " ".join(value.split())
        return value


class ResearchSource(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    url: HttpUrl | None = None
    source_type: SourceType
    retrieved_at: datetime
    evidence_strength: EvidenceStrength


class ResearchFinding(BaseModel):
    category: Literal[
        "skill",
        "role_requirement",
        "interview_stage",
        "technical_subject",
        "inferred_priority",
    ]
    statement: str = Field(min_length=1, max_length=1000)
    evidence_kind: EvidenceKind
    sources: list[ResearchSource] = Field(min_length=1, max_length=10)


class CompanyResearchProfile(BaseModel):
    company_name: str
    target_role: str
    country_region: str | None = None
    key_skills: list[str] = Field(default_factory=list, max_length=30)
    role_requirements: list[str] = Field(default_factory=list, max_length=30)
    interview_stages_or_expectations: list[str] = Field(default_factory=list, max_length=20)
    technical_subject_areas: list[str] = Field(default_factory=list, max_length=30)
    inferred_priorities: list[ResearchFinding] = Field(default_factory=list, max_length=20)
    findings: list[ResearchFinding] = Field(default_factory=list, max_length=80)
    sources: list[ResearchSource] = Field(default_factory=list, max_length=30)
    missing_information: list[str] = Field(default_factory=list, max_length=20)
    limitations: list[str] = Field(default_factory=list, max_length=20)
    retrieval_method: str
    researched_at: datetime
    cache_status: Literal["live", "cached", "stale"] = "live"
    cache_expires_at: datetime | None = None
