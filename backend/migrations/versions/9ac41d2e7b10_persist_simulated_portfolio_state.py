"""persist simulated portfolio state

Revision ID: 9ac41d2e7b10
Revises: f756e4fdf87b
Create Date: 2026-10-13
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9ac41d2e7b10"
down_revision: Union[str, Sequence[str], None] = "f756e4fdf87b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add the column as nullable first so existing portfolios can be backfilled.
    op.add_column(
        "portfolios",
        sa.Column("cash_balance", sa.Numeric(18, 2), nullable=True),
    )

    op.execute(
        "UPDATE portfolios SET cash_balance = initial_capital "
        "WHERE cash_balance IS NULL"
    )

    op.alter_column(
        "portfolios",
        "cash_balance",
        existing_type=sa.Numeric(18, 2),
        nullable=False,
    )

    op.create_check_constraint(
        "ck_portfolio_cash_balance_nonnegative",
        "portfolios",
        "cash_balance >= 0",
    )

    op.create_table(
        "portfolio_holdings",
        sa.Column("portfolio_id", sa.UUID(), nullable=False),
        sa.Column("asset", sa.String(length=100), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("average_price", sa.Numeric(18, 2), nullable=False),
        sa.Column("current_price", sa.Numeric(18, 2), nullable=False),
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
            ["portfolio_id"],
            ["portfolios.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "portfolio_id",
            "asset",
            name="uq_portfolio_holding_asset",
        ),
        sa.CheckConstraint(
            "quantity >= 0",
            name="ck_portfolio_holding_quantity_nonnegative",
        ),
        sa.CheckConstraint(
            "average_price >= 0",
            name="ck_portfolio_holding_average_price_nonnegative",
        ),
        sa.CheckConstraint(
            "current_price >= 0",
            name="ck_portfolio_holding_current_price_nonnegative",
        ),
    )

    op.create_index(
        "ix_portfolio_holdings_portfolio_id",
        "portfolio_holdings",
        ["portfolio_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_portfolio_holdings_portfolio_id",
        table_name="portfolio_holdings",
    )
    op.drop_table("portfolio_holdings")

    op.drop_constraint(
        "ck_portfolio_cash_balance_nonnegative",
        "portfolios",
        type_="check",
    )
    op.drop_column("portfolios", "cash_balance")
