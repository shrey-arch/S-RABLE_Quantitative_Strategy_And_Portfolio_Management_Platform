"""add notification read state checks

Revision ID: notification_read_state_checks
Revises: position_closed_zero_quantity
"""

from alembic import op


revision = "notification_read_state_checks"
down_revision = "position_closed_zero_quantity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_notifications_read_state",
        "notifications",
        "is_read = FALSE OR read_at IS NOT NULL",
    )

    op.create_check_constraint(
        "ck_notifications_unread_state",
        "notifications",
        "is_read = TRUE OR read_at IS NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_notifications_unread_state",
        "notifications",
        type_="check",
    )

    op.drop_constraint(
        "ck_notifications_read_state",
        "notifications",
        type_="check",
    )
