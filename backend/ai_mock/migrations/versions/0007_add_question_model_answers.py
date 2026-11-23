"""Persist generated model answers for interview questions.

Revision ID: 0007_question_model_answers
Revises: 0006_interview_context
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007_question_model_answers"
down_revision: Union[str, Sequence[str], None] = "0006_interview_context"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("model_answer", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("questions", "model_answer")
