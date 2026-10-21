"""Live paper trading API (Feature 7). Virtual money and simulated orders only."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

LiveStatus = Literal["PENDING", "RUNNING", "STALE", "PAUSED", "STOPPED", "COMPLETED", "FAILED"]


class CreateLiveSessionRequest(BaseModel):
    strategy_id: UUID
    instrument_id: UUID
    name: str | None = Field(default=None, max_length=150, description="Defaults to the strategy's name.")
    timeframe: Literal["1M", "5M", "15M"] = "5M"
    mode: Literal["DELAYED", "REPLAY"] = "DELAYED"
    replay_date: date | None = Field(default=None, description="REPLAY: the recorded day to replay.")
    speed: Literal[1, 5, 10] = Field(default=1, description="REPLAY: 1x, 5x or 10x.")
    capital: float = Field(gt=0, le=1e9, description="The slice of the paper account the session may use.")
    quantity: int = Field(gt=0, le=1_000_000, description="Shares per position (as in a backtest).")
    slippage_bps: float = Field(default=5, ge=0, le=500)
    loss_limit_pct: float | None = Field(default=2.0, gt=0, le=100, description="Daily loss limit, % of the capital.")
    max_position_value: float | None = Field(default=None, gt=0, description="Most a position may be worth.")

    @model_validator(mode="after")
    def check(self):
        if self.mode == "REPLAY" and self.replay_date is None:
            raise ValueError("Choose the day to replay.")
        return self


class StopRequest(BaseModel):
    square_off: bool = Field(default=True, description="Square off now; otherwise at 15:20.")


class SessionClock(BaseModel):
    market_time: datetime
    label: str
    open: bool
    finished: bool


class Money(BaseModel):
    equity: float
    realised_pnl: float
    unrealised_pnl: float
    charges: float
    net_pnl: float
    position_value: float | None


class Risk(BaseModel):
    loss: float = Field(description="Capital minus equity now, if positive.")
    loss_limit: float | None = Field(description="The daily loss limit in rupees.")
    loss_used: float | None = Field(description="loss / loss_limit (1 = the limit).")
    position_value: float | None
    position_limit: float = Field(description="The maximum position value, or the capital when none is set.")
    position_used: float | None = Field(description="position_value / position_limit.")


class LiveSessionOut(BaseModel):
    id: UUID
    name: str
    strategy_id: UUID | None
    strategy_key: str
    strategy_version: int | None
    parameters: dict
    rules: dict | None
    instrument_id: UUID
    symbol: str | None
    tick_size: float | None
    timeframe: str
    mode: Literal["DELAYED", "REPLAY"]
    session_date: date
    speed: int
    delay_minutes: int
    clock: SessionClock
    status: LiveStatus
    status_reason: str | None
    stop_requested: str | None
    capital: float
    quantity: int
    slippage_bps: float
    loss_limit_pct: float | None
    max_position_value: float | None
    max_orders_per_bar: int
    position_qty: int
    average_price: float | None
    last_price: float | None
    last_price_at: datetime | None
    last_bar_at: datetime | None
    data_age_seconds: int | None = Field(description="Market seconds since the last bar's close.")
    squared_off: bool
    money: Money
    risk: Risk
    order_count: int
    summary: dict | None
    label: str
    execution_id: UUID | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    simulation_only: bool = True


class Bar(BaseModel):
    time: datetime = Field(description="Bar start.")
    open: float
    high: float
    low: float
    close: float
    volume: float


class FormingBar(Bar):
    minutes: int = Field(description="Complete 1-minute bars in it so far.")
    of: int = Field(description="Minutes in a full bar.")


class LiveBars(BaseModel):
    market_time: datetime
    timeframe: str
    bars: list[Bar]
    forming: FormingBar | None


class LiveEvent(BaseModel):
    id: int
    kind: str
    market_time: datetime | None
    message: str
    data: dict
    created_at: datetime


class LiveFill(BaseModel):
    id: UUID
    order_id: UUID
    side: str
    quantity: int
    price: float
    bar_close: float
    trade_value: float
    charges: dict
    total_charges: float
    net_amount: float
    realised_pnl: float | None
    filled_at: datetime
    reason: str | None


class ReplayDay(BaseModel):
    day: date
    bars: int
    first: datetime
    last: datetime
    replayable: bool


class LiveStatusOut(BaseModel):
    market: dict
    delayed_day: date | None = Field(description="The day a delayed session started now would trade; null when closed.")
    delay_minutes: int
    runner_enabled: bool
    feed: dict | None
    label: str
