"""Add interview personalization and question provenance.

Revision ID: 0006_interview_context
Revises: 0005_add_company_research_cache
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0006_interview_context"
down_revision: Union[str, Sequence[str], None] = "0005_add_company_research_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("interview_sessions", sa.Column("resume_id", sa.Integer(), nullable=True))
    op.add_column("interview_sessions", sa.Column("company_name", sa.String(length=200), nullable=True))
    op.add_column("interview_sessions", sa.Column("country_region", sa.String(length=100), nullable=True))
    op.add_column("interview_sessions", sa.Column("job_description_url", sa.String(length=2048), nullable=True))
    op.add_column("interview_sessions", sa.Column("job_description_text", sa.Text(), nullable=True))
    op.add_column("interview_sessions", sa.Column("job_description_fingerprint", sa.String(length=64), nullable=True))
    op.add_column("interview_sessions", sa.Column("question_count", sa.Integer(), nullable=False, server_default="5"))
    op.create_foreign_key(
        "fk_interview_sessions_resume_id_resumes",
        "interview_sessions",
        "resumes",
        ["resume_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_interview_sessions_resume_id", "interview_sessions", ["resume_id"])
    op.add_column("questions", sa.Column("topic", sa.String(length=200), nullable=True))
    op.add_column("questions", sa.Column("difficulty", sa.String(length=30), nullable=True))
    op.add_column("questions", sa.Column("category", sa.String(length=50), nullable=True))
    op.add_column("questions", sa.Column("source_type", sa.String(length=100), nullable=True))
    op.add_column("questions", sa.Column("source_references", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("questions", "source_references")
    op.drop_column("questions", "source_type")
    op.drop_column("questions", "category")
    op.drop_column("questions", "difficulty")
    op.drop_column("questions", "topic")
    op.drop_index("ix_interview_sessions_resume_id", table_name="interview_sessions")
    op.drop_constraint("fk_interview_sessions_resume_id_resumes", "interview_sessions", type_="foreignkey")
    op.drop_column("interview_sessions", "job_description_fingerprint")
    op.drop_column("interview_sessions", "job_description_url")
    op.drop_column("interview_sessions", "job_description_text")
    op.drop_column("interview_sessions", "country_region")
    op.drop_column("interview_sessions", "company_name")
    op.drop_column("interview_sessions", "resume_id")
    op.drop_column("interview_sessions", "question_count")
