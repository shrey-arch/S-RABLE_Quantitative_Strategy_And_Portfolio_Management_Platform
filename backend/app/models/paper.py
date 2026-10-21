"""Paper trading (Feature 1, P1): a virtual NSE trading account per user.

Virtual money only: orders are matched by S-RABLE against delayed market
quotes and never sent to a broker."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import BaseModelMixin

MONEY = Numeric(18, 2)
PRICE = Numeric(18, 4)


class PaperAccount(BaseModelMixin, Base):
    __tablename__ = "paper_accounts"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_paper_accounts_user"),
        CheckConstraint("initial_cash > 0", name="ck_paper_accounts_initial_cash"),
        CheckConstraint("cash >= 0", name="ck_paper_accounts_cash"),
        CheckConstraint("slippage_bps >= 0", name="ck_paper_accounts_slippage"),
        CheckConstraint("brokerage_per_order >= 0", name="ck_paper_accounts_brokerage"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    initial_cash: Mapped[float] = mapped_column(MONEY, nullable=False)
    cash: Mapped[float] = mapped_column(MONEY, nullable=False)
    realised_pnl: Mapped[float] = mapped_column(MONEY, nullable=False, default=0)
    total_charges: Mapped[float] = mapped_column(MONEY, nullable=False, default=0)
    slippage_bps: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    brokerage_per_order: Mapped[float] = mapped_column(MONEY, nullable=False, default=0)
    watchlist: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    reset_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reset_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaperOrder(BaseModelMixin, Base):
    __tablename__ = "paper_orders"
    __table_args__ = (
        CheckConstraint("side IN ('BUY', 'SELL')", name="ck_paper_orders_side"),
        CheckConstraint(
            "order_type IN ('MARKET', 'LIMIT', 'SL', 'SL_M')", name="ck_paper_orders_type"
        ),
        CheckConstraint("product IN ('CNC', 'MIS')", name="ck_paper_orders_product"),
        CheckConstraint(
            "status IN ('OPEN', 'TRIGGER_PENDING', 'FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED')",
            name="ck_paper_orders_status",
        ),
        CheckConstraint("quantity > 0", name="ck_paper_orders_quantity"),
        CheckConstraint("source IN ('MANUAL', 'STRATEGY', 'LIVE')", name="ck_paper_orders_source"),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Instruments with paper orders cannot be deleted (409), only deactivated.
    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False
    )
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    order_type: Mapped[str] = mapped_column(String(6), nullable=False)
    product: Mapped[str] = mapped_column(String(3), nullable=False, default="CNC")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[float | None] = mapped_column(PRICE)
    trigger_price: Mapped[float | None] = mapped_column(PRICE)
    status: Mapped[str] = mapped_column(String(15), nullable=False)
    status_message: Mapped[str | None] = mapped_column(String(300))
    # The trading day the order is valid for (DAY validity; after-hours orders
    # are valid for the next session).
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    after_market: Mapped[bool] = mapped_column(nullable=False, default=False)
    # Time of the quote seen when placed: only later quotes can fill the order.
    placed_quote_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    filled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    average_price: Mapped[float | None] = mapped_column(PRICE)
    # Cash held back for an open BUY: quantity x price (+ slippage) + charges.
    reserved_amount: Mapped[float | None] = mapped_column(MONEY)
    source: Mapped[str] = mapped_column(String(10), nullable=False, default="MANUAL")
    # P2: orders a strategy deployment placed (source STRATEGY).
    deployment_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("paper_deployments.id", ondelete="SET NULL"), index=True
    )
    # Feature 7: orders a live session placed (source LIVE, product MIS).
    live_session_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("live_sessions.id", ondelete="SET NULL"), index=True
    )
    # P3 journal: the user's own note and tags on the trade.
    note: Mapped[str | None] = mapped_column(String(1000))
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class PaperFill(BaseModelMixin, Base):
    __tablename__ = "paper_fills"

    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False
    )
    side: Mapped[str] = mapped_column(String(4), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[float] = mapped_column(PRICE, nullable=False)
    quote_price: Mapped[float] = mapped_column(PRICE, nullable=False)
    quote_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    trade_value: Mapped[float] = mapped_column(MONEY, nullable=False)
    charges: Mapped[dict] = mapped_column(JSONB, nullable=False)
    total_charges: Mapped[float] = mapped_column(MONEY, nullable=False)
    # Change in cash: -(value + charges) on a buy, +(value - charges) on a sell.
    net_amount: Mapped[float] = mapped_column(MONEY, nullable=False)
    # Sells: (fill price - average cost) x quantity, before charges.
    realised_pnl: Mapped[float | None] = mapped_column(MONEY)
    filled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class PaperHolding(BaseModelMixin, Base):
    __tablename__ = "paper_holdings"
    __table_args__ = (
        UniqueConstraint("account_id", "instrument_id", name="uq_paper_holdings_instrument"),
        CheckConstraint("quantity > 0", name="ck_paper_holdings_quantity"),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    average_price: Mapped[float] = mapped_column(PRICE, nullable=False)


class PaperCashEntry(BaseModelMixin, Base):
    __tablename__ = "paper_cash_ledger"
    __table_args__ = (
        CheckConstraint("kind IN ('OPENING', 'BUY', 'SELL')", name="ck_paper_cash_kind"),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    amount: Mapped[float] = mapped_column(MONEY, nullable=False)
    balance_after: Mapped[float] = mapped_column(MONEY, nullable=False)
    fill_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("paper_fills.id", ondelete="CASCADE")
    )
    note: Mapped[str | None] = mapped_column(String(200))


class PaperDeployment(BaseModelMixin, Base):
    """A strategy trading the paper account at each day's close (P2)."""

    __tablename__ = "paper_deployments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED')",
            name="ck_paper_deployments_status",
        ),
        CheckConstraint("capital > 0", name="ck_paper_deployments_capital"),
        CheckConstraint("quantity > 0", name="ck_paper_deployments_quantity"),
    )

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_id: Mapped[UUID | None] = mapped_column(ForeignKey("strategies.id", ondelete="SET NULL"))
    # Validation stage 5: the validation this deployment is the paper stage of.
    validation_id: Mapped[UUID | None] = mapped_column(ForeignKey("executions.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    strategy_key: Mapped[str] = mapped_column(String(60), nullable=False)
    strategy_version: Mapped[int | None] = mapped_column(Integer)
    parameters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    rules: Mapped[dict | None] = mapped_column(JSONB)
    layout: Mapped[str] = mapped_column(String(10), nullable=False)
    instrument_ids: Mapped[list] = mapped_column(JSONB, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    capital: Mapped[float] = mapped_column(MONEY, nullable=False)
    loss_limit: Mapped[float | None] = mapped_column(Float)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="ACTIVE")
    status_reason: Mapped[str | None] = mapped_column(String(300))
    last_processed_date: Mapped[date | None] = mapped_column(Date)
    state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    peak_equity: Mapped[float | None] = mapped_column(MONEY)
    breaches: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaperDeploymentDay(BaseModelMixin, Base):
    """One trading day of a deployment: what it saw, decided and did."""

    __tablename__ = "paper_deployment_days"
    __table_args__ = (UniqueConstraint("deployment_id", "day", name="uq_paper_deployment_days_day"),)

    deployment_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_deployments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    closes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    signal: Mapped[str | None] = mapped_column(String(10))
    allocations: Mapped[dict | None] = mapped_column(JSONB)
    targets: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    orders: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    cash: Mapped[float | None] = mapped_column(MONEY)
    positions_value: Mapped[float | None] = mapped_column(MONEY)
    equity: Mapped[float | None] = mapped_column(MONEY)
    drawdown: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(String(500))


class PaperEquitySnapshot(BaseModelMixin, Base):
    """The whole account's value at a day's close (P3 performance)."""

    __tablename__ = "paper_equity_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "day", name="uq_paper_equity_snapshots_day"),)

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    cash: Mapped[float] = mapped_column(MONEY, nullable=False)
    holdings_value: Mapped[float] = mapped_column(MONEY, nullable=False)
    equity: Mapped[float] = mapped_column(MONEY, nullable=False)
    note: Mapped[str | None] = mapped_column(String(300))
