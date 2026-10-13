"""add trade numeric checks

Revision ID: trade_numeric_checks
Revises: order_numeric_checks
Create Date: 2026-10-01
"""

from alembic import op


revision = "trade_numeric_checks"
down_revision = "order_numeric_checks"
branch_labels = None
depends_on = None


def upgrade():
    op.create_check_constraint(
        "ck_trades_executed_quantity_positive",
        "trades",
        "executed_quantity > 0",
    )

    op.create_check_constraint(
        "ck_trades_executed_price_positive",
        "trades",
        "executed_price > 0",
    )

    op.create_check_constraint(
        "ck_trades_brokerage_nonnegative",
        "trades",
        "brokerage >= 0",
    )

    op.create_check_constraint(
        "ck_trades_total_charges_nonnegative",
        "trades",
        "total_charges >= 0",
    )


def downgrade():
    op.drop_constraint(
        "ck_trades_total_charges_nonnegative",
        "trades",
        type_="check",
    )

    op.drop_constraint(
        "ck_trades_brokerage_nonnegative",
        "trades",
        type_="check",
    )

    op.drop_constraint(
        "ck_trades_executed_price_positive",
        "trades",
        type_="check",
    )

    op.drop_constraint(
        "ck_trades_executed_quantity_positive",
        "trades",
        type_="check",
    )
