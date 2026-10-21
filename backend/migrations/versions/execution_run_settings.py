"""add executions.run_settings

Revision ID: execution_run_settings
Revises: strategy_python_code
Create Date: 2026-10-16
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "execution_run_settings"
down_revision = "strategy_python_code"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "executions",
        sa.Column("run_settings", postgresql.JSONB(), nullable=True),
    )


def downgrade():
    op.drop_column("executions", "run_settings")
