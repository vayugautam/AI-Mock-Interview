"""Extend evaluations for structured text analysis.

Revision ID: 0003_text_evaluation
Revises: 0002_one_answer_per_question
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_text_evaluation"
down_revision: Union[str, Sequence[str], None] = "0002_one_answer_per_question"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("evaluations", sa.Column("reasoning", sa.Text(), nullable=True))
    op.add_column("evaluations", sa.Column("strengths", sa.Text(), nullable=True))
    op.add_column("evaluations", sa.Column("weaknesses", sa.Text(), nullable=True))
    op.add_column("evaluations", sa.Column("missing_concepts", sa.Text(), nullable=True))
    op.add_column("evaluations", sa.Column("improvement_suggestions", sa.Text(), nullable=True))
    op.add_column("evaluations", sa.Column("is_off_topic", sa.Boolean(), nullable=True))
    op.add_column("evaluations", sa.Column("provider", sa.String(length=100), nullable=True))
    op.add_column("evaluations", sa.Column("model", sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column("evaluations", "model")
    op.drop_column("evaluations", "provider")
    op.drop_column("evaluations", "is_off_topic")
    op.drop_column("evaluations", "improvement_suggestions")
    op.drop_column("evaluations", "missing_concepts")
    op.drop_column("evaluations", "weaknesses")
    op.drop_column("evaluations", "strengths")
    op.drop_column("evaluations", "reasoning")
