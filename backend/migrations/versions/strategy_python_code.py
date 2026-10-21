"""add strategies.python_code

Revision ID: strategy_python_code
Revises: 9ac41d2e7b10
Create Date: 2026-10-16
"""

from alembic import op
import sqlalchemy as sa


revision = "strategy_python_code"
down_revision = "9ac41d2e7b10"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "strategies",
        sa.Column("python_code", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("strategies", "python_code")
