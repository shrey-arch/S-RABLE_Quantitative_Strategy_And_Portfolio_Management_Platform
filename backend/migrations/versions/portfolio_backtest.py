"""portfolio backtest against Nifty 50 (Feature 4): a new execution type,
PORTFOLIO_BACKTEST, run by the backtest worker like the other runs

Revision ID: portfolio_backtest
Revises: supervised_regime
Create Date: 2026-10-18
"""

from alembic import op


revision = "portfolio_backtest"
down_revision = "supervised_regime"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # A new value of a PostgreSQL enum must be added outside a transaction.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE execution_type ADD VALUE IF NOT EXISTS 'PORTFOLIO_BACKTEST'")


def downgrade() -> None:
    # PostgreSQL cannot drop one value of an enum; the value stays (unused) on downgrade.
    pass
