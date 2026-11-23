"""Create Phase 1 application tables.

Revision ID: 0001_phase_one
Revises:
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_phase_one"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)

    op.create_table(
        "interview_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=120), nullable=False),
        sa.Column("difficulty", sa.String(length=30), nullable=False),
        sa.Column("interview_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_interview_sessions_user_id", "interview_sessions", ["user_id"], unique=False)

    op.create_table(
        "questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_text", sa.String(length=2000), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.UniqueConstraint("session_id", "sequence_number", name="uq_questions_session_sequence"),
    )
    op.create_index("ix_questions_session_id", "questions", ["session_id"], unique=False)

    op.create_table(
        "answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("answer_text", sa.String(length=10000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_answers_session_id", "answers", ["session_id"], unique=False)
    op.create_index("ix_answers_question_id", "answers", ["question_id"], unique=False)

    op.create_table(
        "evaluations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("answer_id", sa.Integer(), sa.ForeignKey("answers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("correctness_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("relevance_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("clarity_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("completeness_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("overall_score", sa.Numeric(5, 2), nullable=False),
        sa.Column("feedback", sa.String(length=5000), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("answer_id", name="uq_evaluations_answer_id"),
    )
    op.create_index("ix_evaluations_answer_id", "evaluations", ["answer_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_evaluations_answer_id", table_name="evaluations")
    op.drop_table("evaluations")
    op.drop_index("ix_answers_question_id", table_name="answers")
    op.drop_index("ix_answers_session_id", table_name="answers")
    op.drop_table("answers")
    op.drop_index("ix_questions_session_id", table_name="questions")
    op.drop_table("questions")
    op.drop_index("ix_interview_sessions_user_id", table_name="interview_sessions")
    op.drop_table("interview_sessions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
