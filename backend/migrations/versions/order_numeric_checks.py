"""add order numeric validation constraints

Revision ID: order_numeric_checks
Revises: 6674fd5b5a3b
Create Date: 2026-09-29
"""

from typing import Sequence, Union

from alembic import op


revision: str = "order_numeric_checks"
down_revision: Union[str, Sequence[str], None] = "6674fd5b5a3b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_orders_quantity_positive",
        "orders",
        "quantity > 0",
    )

    op.create_check_constraint(
        "ck_orders_filled_quantity_nonnegative",
        "orders",
        "filled_quantity >= 0",
    )

    op.create_check_constraint(
        "ck_orders_price_positive",
        "orders",
        "price > 0",
    )

    op.create_check_constraint(
        "ck_orders_average_fill_price_positive",
        "orders",
        "average_fill_price IS NULL OR average_fill_price > 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_orders_average_fill_price_positive",
        "orders",
        type_="check",
    )

    op.drop_constraint(
        "ck_orders_price_positive",
        "orders",
        type_="check",
    )

    op.drop_constraint(
        "ck_orders_filled_quantity_nonnegative",
        "orders",
        type_="check",
    )

    op.drop_constraint(
        "ck_orders_quantity_positive",
        "orders",
        type_="check",
    )
