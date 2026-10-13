"""add execution initial capital check

Revision ID: 6674fd5b5a3b
Revises: 747940c5cf1a
Create Date: 2026-09-26 23:21:11.882475

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "6674fd5b5a3b"
down_revision: Union[str, Sequence[str], None] = "747940c5cf1a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_check_constraint(
        "ck_executions_initial_capital_positive",
        "executions",
        "initial_capital > 0",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_executions_initial_capital_positive",
        "executions",
        type_="check",
    )
