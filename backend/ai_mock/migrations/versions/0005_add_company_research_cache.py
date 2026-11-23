"""Add persistent company research cache.

Revision ID: 0005_add_company_research_cache
Revises: 0004_add_resumes
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005_add_company_research_cache"
down_revision: Union[str, Sequence[str], None] = "0004_add_resumes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "company_research_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("company_key", sa.String(length=200), nullable=False),
        sa.Column("role_key", sa.String(length=160), nullable=False),
        sa.Column("region_key", sa.String(length=100), nullable=False),
        sa.Column("company_name", sa.String(length=200), nullable=False),
        sa.Column("target_role", sa.String(length=160), nullable=False),
        sa.Column("country_region", sa.String(length=100), nullable=True),
        sa.Column("job_description_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("profile_json", sa.Text(), nullable=False),
        sa.Column("researched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint(
            "company_key", "role_key", "region_key",
            name="uq_company_research_cache_lookup",
        ),
    )
    op.create_index(
        "ix_company_research_cache_expires_at",
        "company_research_cache",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_company_research_cache_expires_at", table_name="company_research_cache")
    op.drop_table("company_research_cache")
