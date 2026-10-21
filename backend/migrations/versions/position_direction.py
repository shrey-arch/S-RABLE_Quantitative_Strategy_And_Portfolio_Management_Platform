"""add positions.direction (Phase 15: short positions from backtests are recorded)

Revision ID: position_direction
Revises: regime_models
Create Date: 2026-10-17
"""

from alembic import op
import sqlalchemy as sa


revision = "position_direction"
down_revision = "regime_models"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "positions",
        sa.Column("direction", sa.String(length=5), nullable=False, server_default="LONG"),
    )
    op.create_check_constraint(
        "ck_positions_direction",
        "positions",
        "direction IN ('LONG', 'SHORT')",
    )


def downgrade():
    op.drop_constraint("ck_positions_direction", "positions", type_="check")
    op.drop_column("positions", "direction")
