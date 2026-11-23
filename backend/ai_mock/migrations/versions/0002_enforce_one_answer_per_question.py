"""Enforce one answer per question.

Revision ID: 0002_one_answer_per_question
Revises: 0001_phase_one
"""
from typing import Sequence, Union

from alembic import op


revision: str = "0002_one_answer_per_question"
down_revision: Union[str, Sequence[str], None] = "0001_phase_one"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index("ix_answers_question_id", table_name="answers")
    op.create_index("ix_answers_question_id", "answers", ["question_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_answers_question_id", table_name="answers")
    op.create_index("ix_answers_question_id", "answers", ["question_id"], unique=False)
