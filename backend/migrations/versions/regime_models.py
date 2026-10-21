"""add regime_models (Phase 12 market-regime models trained from the website)

Revision ID: regime_models
Revises: execution_type_validation
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "regime_models"
down_revision = "execution_type_validation"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "regime_models",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("model_version", sa.String(length=50), nullable=False),
        sa.Column("instrument_id", sa.UUID(), nullable=True),
        sa.Column("trained_by_user_id", sa.UUID(), nullable=True),
        sa.Column("settings", postgresql.JSONB(), nullable=False),
        sa.Column("model_metadata", postgresql.JSONB(), nullable=True),
        sa.Column("artifact", sa.LargeBinary(), nullable=True),
        sa.Column("error_message", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["instrument_id"], ["instruments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["trained_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number", name="uq_regime_model_number"),
        sa.CheckConstraint(
            "status IN ('TRAINING', 'READY', 'FAILED')",
            name="ck_regime_model_status",
        ),
    )


def downgrade():
    op.drop_table("regime_models")
