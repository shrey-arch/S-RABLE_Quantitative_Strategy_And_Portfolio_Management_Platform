"""allow zero quantity for closed positions

Revision ID: position_closed_zero_quantity
Revises: position_numeric_checks
"""

from alembic import op


revision = "position_closed_zero_quantity"
down_revision = "position_numeric_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_positions_quantity_positive",
        "positions",
        type_="check",
    )

    op.create_check_constraint(
        "ck_positions_quantity_nonnegative",
        "positions",
        "quantity >= 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_positions_quantity_nonnegative",
        "positions",
        type_="check",
    )

    op.create_check_constraint(
        "ck_positions_quantity_positive",
        "positions",
        "quantity > 0",
    )
