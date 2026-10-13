"""add portfolio domain

Revision ID: f756e4fdf87b
Revises: market_data_foundation
Create Date: 2026-10-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f756e4fdf87b"
down_revision: Union[str, Sequence[str], None] = "market_data_foundation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "portfolios",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("initial_capital", sa.Numeric(18, 2), nullable=False),
        sa.Column("id", sa.UUID(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "initial_capital > 0",
            name="ck_portfolio_initial_capital_positive",
        ),
    )

    op.create_index(
        "ix_portfolios_user_id",
        "portfolios",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "portfolio_executions",
        sa.Column("portfolio_id", sa.UUID(), nullable=False),
        sa.Column("execution_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ["portfolio_id"],
            ["portfolios.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"],
            ["executions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("portfolio_id", "execution_id"),
    )


def downgrade() -> None:
    op.drop_table("portfolio_executions")

    op.drop_index(
        "ix_portfolios_user_id",
        table_name="portfolios",
    )

    op.drop_table("portfolios")
