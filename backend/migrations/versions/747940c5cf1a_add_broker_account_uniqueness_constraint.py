"""add broker account uniqueness constraint

Revision ID: 747940c5cf1a
Revises: d6db3536419f
Create Date: 2026-09-02 01:09:15.998391

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '747940c5cf1a'
down_revision: Union[str, Sequence[str], None] = 'd6db3536419f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint(
        "uq_broker_account_user_broker_user",
        "broker_accounts",
        ["user_id", "broker_name", "broker_user_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "uq_broker_account_user_broker_user",
        "broker_accounts",
        type_="unique",
    )
