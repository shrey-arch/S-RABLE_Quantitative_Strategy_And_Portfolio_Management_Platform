"""paper trading accounts, orders, fills, holdings and cash ledger (Feature 1, P1)

Revision ID: paper_trading
Revises: position_direction
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "paper_trading"
down_revision = "position_direction"
branch_labels = None
depends_on = None

MONEY = sa.Numeric(18, 2)
PRICE = sa.Numeric(18, 4)


def _base():
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade():
    op.create_table(
        "paper_accounts",
        *_base(),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("initial_cash", MONEY, nullable=False),
        sa.Column("cash", MONEY, nullable=False),
        sa.Column("realised_pnl", MONEY, nullable=False, server_default="0"),
        sa.Column("total_charges", MONEY, nullable=False, server_default="0"),
        sa.Column("slippage_bps", sa.Float(), nullable=False, server_default="5"),
        sa.Column("brokerage_per_order", MONEY, nullable=False, server_default="0"),
        sa.Column("watchlist", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("reset_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_reset_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", name="uq_paper_accounts_user"),
        sa.CheckConstraint("initial_cash > 0", name="ck_paper_accounts_initial_cash"),
        sa.CheckConstraint("cash >= 0", name="ck_paper_accounts_cash"),
        sa.CheckConstraint("slippage_bps >= 0", name="ck_paper_accounts_slippage"),
        sa.CheckConstraint("brokerage_per_order >= 0", name="ck_paper_accounts_brokerage"),
    )
    op.create_table(
        "paper_orders",
        *_base(),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("order_type", sa.String(6), nullable=False),
        sa.Column("product", sa.String(3), nullable=False, server_default="CNC"),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("price", PRICE),
        sa.Column("trigger_price", PRICE),
        sa.Column("status", sa.String(15), nullable=False),
        sa.Column("status_message", sa.String(300)),
        sa.Column("session_date", sa.Date(), nullable=False),
        sa.Column("after_market", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("placed_quote_time", sa.DateTime(timezone=True)),
        sa.Column("triggered_at", sa.DateTime(timezone=True)),
        sa.Column("filled_at", sa.DateTime(timezone=True)),
        sa.Column("average_price", PRICE),
        sa.Column("reserved_amount", MONEY),
        sa.Column("source", sa.String(10), nullable=False, server_default="MANUAL"),
        sa.CheckConstraint("side IN ('BUY', 'SELL')", name="ck_paper_orders_side"),
        sa.CheckConstraint("order_type IN ('MARKET', 'LIMIT', 'SL', 'SL_M')", name="ck_paper_orders_type"),
        sa.CheckConstraint("product IN ('CNC')", name="ck_paper_orders_product"),
        sa.CheckConstraint(
            "status IN ('OPEN', 'TRIGGER_PENDING', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED')",
            name="ck_paper_orders_status",
        ),
        sa.CheckConstraint("quantity > 0", name="ck_paper_orders_quantity"),
    )
    op.create_index("ix_paper_orders_account_id", "paper_orders", ["account_id"])
    op.create_table(
        "paper_fills",
        *_base(),
        sa.Column("order_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("paper_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("price", PRICE, nullable=False),
        sa.Column("quote_price", PRICE, nullable=False),
        sa.Column("quote_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("trade_value", MONEY, nullable=False),
        sa.Column("charges", postgresql.JSONB(), nullable=False),
        sa.Column("total_charges", MONEY, nullable=False),
        sa.Column("net_amount", MONEY, nullable=False),
        sa.Column("realised_pnl", MONEY),
        sa.Column("filled_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_paper_fills_order_id", "paper_fills", ["order_id"])
    op.create_index("ix_paper_fills_account_id", "paper_fills", ["account_id"])
    op.create_table(
        "paper_holdings",
        *_base(),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("instrument_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("average_price", PRICE, nullable=False),
        sa.UniqueConstraint("account_id", "instrument_id", name="uq_paper_holdings_instrument"),
        sa.CheckConstraint("quantity > 0", name="ck_paper_holdings_quantity"),
    )
    op.create_index("ix_paper_holdings_account_id", "paper_holdings", ["account_id"])
    op.create_table(
        "paper_cash_ledger",
        *_base(),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("amount", MONEY, nullable=False),
        sa.Column("balance_after", MONEY, nullable=False),
        sa.Column("fill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("paper_fills.id", ondelete="CASCADE")),
        sa.Column("note", sa.String(200)),
        sa.CheckConstraint("kind IN ('OPENING', 'BUY', 'SELL')", name="ck_paper_cash_kind"),
    )
    op.create_index("ix_paper_cash_ledger_account_id", "paper_cash_ledger", ["account_id"])


def downgrade():
    op.drop_table("paper_cash_ledger")
    op.drop_table("paper_holdings")
    op.drop_table("paper_fills")
    op.drop_table("paper_orders")
    op.drop_table("paper_accounts")
