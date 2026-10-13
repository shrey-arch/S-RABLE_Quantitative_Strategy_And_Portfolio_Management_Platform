"""create market data table

Revision ID: market_data_foundation
Revises: notification_read_state_checks
Create Date: 2026-10-03
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "market_data_foundation"
down_revision: Union[str, Sequence[str], None] = "notification_read_state_checks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    timeframe_enum = sa.Enum(
        "1M",
        "5M",
        "15M",
        "1H",
        "1D",
        name="timeframe",
    )

    op.create_table(
        "market_data",
        sa.Column(
            "instrument_id",
            sa.UUID(),
            nullable=False,
        ),
        sa.Column(
            "timestamp",
            sa.DateTime(timezone=True),
            nullable=False,
        ),
        sa.Column(
            "timeframe",
            timeframe_enum,
            nullable=False,
        ),
        sa.Column(
            "open",
            sa.Float(),
            nullable=False,
        ),
        sa.Column(
            "high",
            sa.Float(),
            nullable=False,
        ),
        sa.Column(
            "low",
            sa.Float(),
            nullable=False,
        ),
        sa.Column(
            "close",
            sa.Float(),
            nullable=False,
        ),
        sa.Column(
            "volume",
            sa.Integer(),
            nullable=False,
        ),
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            nullable=False,
        ),
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
            ["instrument_id"],
            ["instruments.id"],
        ),
        sa.UniqueConstraint(
            "instrument_id",
            "timestamp",
            "timeframe",
            name="uq_market_data_instrument_timestamp_timeframe",
        ),
        sa.CheckConstraint(
            '"open" > 0',
            name="ck_market_data_open_positive",
        ),
        sa.CheckConstraint(
            '"high" > 0',
            name="ck_market_data_high_positive",
        ),
        sa.CheckConstraint(
            '"low" > 0',
            name="ck_market_data_low_positive",
        ),
        sa.CheckConstraint(
            '"close" > 0',
            name="ck_market_data_close_positive",
        ),
        sa.CheckConstraint(
            "volume >= 0",
            name="ck_market_data_volume_nonnegative",
        ),
        sa.CheckConstraint(
            '"high" >= "low"',
            name="ck_market_data_high_gte_low",
        ),
        sa.CheckConstraint(
            '"high" >= "open"',
            name="ck_market_data_high_gte_open",
        ),
        sa.CheckConstraint(
            '"high" >= "close"',
            name="ck_market_data_high_gte_close",
        ),
        sa.CheckConstraint(
            '"low" <= "open"',
            name="ck_market_data_low_lte_open",
        ),
        sa.CheckConstraint(
            '"low" <= "close"',
            name="ck_market_data_low_lte_close",
        ),
    )

    op.create_index(
        "ix_market_data_instrument_timestamp",
        "market_data",
        ["instrument_id", "timestamp"],
    )

    op.create_index(
        "ix_market_data_instrument_timeframe_timestamp",
        "market_data",
        ["instrument_id", "timeframe", "timestamp"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_market_data_instrument_timeframe_timestamp",
        table_name="market_data",
    )

    op.drop_index(
        "ix_market_data_instrument_timestamp",
        table_name="market_data",
    )

    op.drop_table("market_data")

    sa.Enum(
        "1M",
        "5M",
        "15M",
        "1H",
        "1D",
        name="timeframe",
    ).drop(op.get_bind(), checkfirst=True)
