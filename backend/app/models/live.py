"""Live paper trading (Feature 7): stored 1-minute bars, live sessions and their
audit log.

Virtual money only: a session's orders are simulated fills in the user's paper
account (product MIS) and are never sent to a broker. Live bars are stored apart
from the historical bars in market_data and never mixed with them."""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import BaseModelMixin

MONEY = Numeric(18, 2)
PRICE = Numeric(18, 4)

LIVE_STATUSES = ("PENDING", "RUNNING", "STALE", "PAUSED", "STOPPED", "COMPLETED", "FAILED")
LIVE_MODES = ("DELAYED", "REPLAY")


class LiveBar(Base):
    """One 1-minute bar of an instrument as the live feed delivered it.
    `timestamp` is the bar's start (UTC); `received_at` when it was stored."""

    __tablename__ = "live_bars"
    __table_args__ = (
        UniqueConstraint("instrument_id", "timestamp", name="uq_live_bars_instrument_time"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    open: Mapped[float] = mapped_column(PRICE, nullable=False)
    high: Mapped[float] = mapped_column(PRICE, nullable=False)
    low: Mapped[float] = mapped_column(PRICE, nullable=False)
    close: Mapped[float] = mapped_column(PRICE, nullable=False)
    volume: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LiveSession(BaseModelMixin, Base):
    __tablename__ = "live_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'RUNNING', 'STALE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED')",
            name="ck_live_sessions_status",
        ),
        CheckConstraint("mode IN ('DELAYED', 'REPLAY')", name="ck_live_sessions_mode"),
        CheckConstraint("timeframe IN ('1M', '5M', '15M')", name="ck_live_sessions_timeframe"),
        CheckConstraint("capital > 0", name="ck_live_sessions_capital"),
        CheckConstraint("quantity > 0", name="ck_live_sessions_quantity"),
        CheckConstraint("speed IN (1, 5, 10)", name="ck_live_sessions_speed"),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("paper_accounts.id", ondelete="CASCADE"), nullable=False
    )
    execution_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("executions.id", ondelete="SET NULL")
    )
    strategy_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    strategy_key: Mapped[str] = mapped_column(String(60), nullable=False)
    strategy_version: Mapped[int | None] = mapped_column(Integer)
    parameters: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    rules: Mapped[dict | None] = mapped_column(JSONB)
    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id", ondelete="RESTRICT"), nullable=False
    )
    timeframe: Mapped[str] = mapped_column(String(3), nullable=False)
    mode: Mapped[str] = mapped_column(String(7), nullable=False)
    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    speed: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    delay_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    capital: Mapped[float] = mapped_column(MONEY, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    slippage_bps: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    loss_limit_pct: Mapped[float | None] = mapped_column(Float)
    max_position_value: Mapped[float | None] = mapped_column(MONEY)
    max_orders_per_bar: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="PENDING")
    status_reason: Mapped[str | None] = mapped_column(String(300))
    # The session's own position and money (MIS, flat at the end of the day).
    position_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    average_price: Mapped[float | None] = mapped_column(PRICE)
    realised_pnl: Mapped[float] = mapped_column(MONEY, nullable=False, default=0)
    charges: Mapped[float] = mapped_column(MONEY, nullable=False, default=0)
    order_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Progress: the last closed bar handed to the strategy, and the data clock.
    last_bar_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_price: Mapped[float | None] = mapped_column(PRICE)
    last_price_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stale_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    squared_off: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    stop_requested: Mapped[str | None] = mapped_column(String(20))
    state: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    summary: Mapped[dict | None] = mapped_column(JSONB)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LiveSessionEvent(Base):
    """The audit log: one row per decision, in order (id), with the market time
    it refers to and the wall time it was written."""

    __tablename__ = "live_session_events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("live_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    market_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
