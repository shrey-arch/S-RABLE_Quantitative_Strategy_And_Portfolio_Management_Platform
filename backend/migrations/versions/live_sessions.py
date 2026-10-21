"""live paper trading (Feature 7): stored 1-minute live bars, live sessions and
their audit log; intraday (MIS) orders placed by a live session

Revision ID: live_sessions
Revises: portfolio_backtest
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "live_sessions"
down_revision = "portfolio_backtest"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
PRICE = sa.Numeric(18, 4)
UUID = postgresql.UUID(as_uuid=True)


def upgrade():
    op.create_table(
        "live_bars",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("instrument_id", UUID, sa.ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", PRICE, nullable=False),
        sa.Column("high", PRICE, nullable=False),
        sa.Column("low", PRICE, nullable=False),
        sa.Column("close", PRICE, nullable=False),
        sa.Column("volume", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("instrument_id", "timestamp", name="uq_live_bars_instrument_time"),
    )
    op.create_index("ix_live_bars_instrument_id", "live_bars", ["instrument_id"])

    op.create_table(
        "live_sessions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", UUID, sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("execution_id", UUID, sa.ForeignKey("executions.id", ondelete="SET NULL")),
        sa.Column("strategy_id", UUID, sa.ForeignKey("strategies.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("strategy_key", sa.String(60), nullable=False),
        sa.Column("strategy_version", sa.Integer()),
        sa.Column("parameters", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("rules", postgresql.JSONB()),
        sa.Column("instrument_id", UUID, sa.ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("timeframe", sa.String(3), nullable=False),
        sa.Column("mode", sa.String(7), nullable=False),
        sa.Column("session_date", sa.Date(), nullable=False),
        sa.Column("speed", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("delay_minutes", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("capital", MONEY, nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("slippage_bps", sa.Float(), nullable=False, server_default="5"),
        sa.Column("loss_limit_pct", sa.Float()),
        sa.Column("max_position_value", MONEY),
        sa.Column("max_orders_per_bar", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("status", sa.String(10), nullable=False, server_default="PENDING"),
        sa.Column("status_reason", sa.String(300)),
        sa.Column("position_qty", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("average_price", PRICE),
        sa.Column("realised_pnl", MONEY, nullable=False, server_default="0"),
        sa.Column("charges", MONEY, nullable=False, server_default="0"),
        sa.Column("order_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_bar_at", sa.DateTime(timezone=True)),
        sa.Column("last_price", PRICE),
        sa.Column("last_price_at", sa.DateTime(timezone=True)),
        sa.Column("stale_since", sa.DateTime(timezone=True)),
        sa.Column("squared_off", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("stop_requested", sa.String(20)),
        sa.Column("state", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("summary", postgresql.JSONB()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('PENDING', 'RUNNING', 'STALE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED')",
            name="ck_live_sessions_status",
        ),
        sa.CheckConstraint("mode IN ('DELAYED', 'REPLAY')", name="ck_live_sessions_mode"),
        sa.CheckConstraint("timeframe IN ('1M', '5M', '15M')", name="ck_live_sessions_timeframe"),
        sa.CheckConstraint("capital > 0", name="ck_live_sessions_capital"),
        sa.CheckConstraint("quantity > 0", name="ck_live_sessions_quantity"),
        sa.CheckConstraint("speed IN (1, 5, 10)", name="ck_live_sessions_speed"),
    )
    op.create_index("ix_live_sessions_user_id", "live_sessions", ["user_id"])

    op.create_table(
        "live_session_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("session_id", UUID, sa.ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("market_time", sa.DateTime(timezone=True)),
        sa.Column("message", sa.String(500), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_live_session_events_session_id", "live_session_events", ["session_id"])

    op.add_column(
        "paper_orders",
        sa.Column("live_session_id", UUID, sa.ForeignKey("live_sessions.id", ondelete="SET NULL")),
    )
    op.create_index("ix_paper_orders_live_session_id", "paper_orders", ["live_session_id"])
    op.drop_constraint("ck_paper_orders_product", "paper_orders", type_="check")
    op.create_check_constraint("ck_paper_orders_product", "paper_orders", "product IN ('CNC', 'MIS')")
    op.drop_constraint("ck_paper_orders_source", "paper_orders", type_="check")
    op.create_check_constraint(
        "ck_paper_orders_source", "paper_orders", "source IN ('MANUAL', 'STRATEGY', 'LIVE')"
    )


def downgrade():
    op.drop_constraint("ck_paper_orders_source", "paper_orders", type_="check")
    op.create_check_constraint("ck_paper_orders_source", "paper_orders", "source IN ('MANUAL', 'STRATEGY')")
    op.drop_constraint("ck_paper_orders_product", "paper_orders", type_="check")
    op.create_check_constraint("ck_paper_orders_product", "paper_orders", "product IN ('CNC')")
    op.drop_index("ix_paper_orders_live_session_id", table_name="paper_orders")
    op.drop_column("paper_orders", "live_session_id")
    op.drop_index("ix_live_session_events_session_id", table_name="live_session_events")
    op.drop_table("live_session_events")
    op.drop_index("ix_live_sessions_user_id", table_name="live_sessions")
    op.drop_table("live_sessions")
    op.drop_index("ix_live_bars_instrument_id", table_name="live_bars")
    op.drop_table("live_bars")
