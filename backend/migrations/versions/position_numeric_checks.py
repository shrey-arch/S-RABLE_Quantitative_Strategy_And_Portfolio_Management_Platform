"""add position numeric checks

Revision ID: position_numeric_checks
Revises: trade_numeric_checks
"""

from alembic import op


revision = "position_numeric_checks"
down_revision = "trade_numeric_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_positions_quantity_positive",
        "positions",
        "quantity > 0",
    )

    op.create_check_constraint(
        "ck_positions_average_price_positive",
        "positions",
        "average_price > 0",
    )

    op.create_check_constraint(
        "ck_positions_current_price_positive",
        "positions",
        "current_price IS NULL OR current_price > 0",
    )

    op.create_check_constraint(
        "ck_positions_market_value_nonnegative",
        "positions",
        "market_value IS NULL OR market_value >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_positions_market_value_nonnegative",
        "positions",
        type_="check",
    )

    op.drop_constraint(
        "ck_positions_current_price_positive",
        "positions",
        type_="check",
    )

    op.drop_constraint(
        "ck_positions_average_price_positive",
        "positions",
        type_="check",
    )

    op.drop_constraint(
        "ck_positions_quantity_positive",
        "positions",
        type_="check",
    )
