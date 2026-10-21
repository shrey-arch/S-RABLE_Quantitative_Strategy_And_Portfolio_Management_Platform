"""Paper trading request and response models (Feature 1, P1)."""

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class OrderRequest(_Strict):
    instrument_id: UUID
    side: Literal["BUY", "SELL"]
    order_type: Literal["MARKET", "LIMIT", "SL", "SL_M"]
    quantity: int = Field(ge=1, le=1_000_000)
    price: Decimal | None = Field(default=None, gt=0, le=10_000_000)
    trigger_price: Decimal | None = Field(default=None, gt=0, le=10_000_000)


class ModifyOrderRequest(_Strict):
    quantity: int | None = Field(default=None, ge=1, le=1_000_000)
    price: Decimal | None = Field(default=None, gt=0, le=10_000_000)
    trigger_price: Decimal | None = Field(default=None, gt=0, le=10_000_000)

    @model_validator(mode="after")
    def _something(self):
        if self.quantity is None and self.price is None and self.trigger_price is None:
            raise ValueError("Change the quantity, price or trigger price.")
        return self


class ResetRequest(_Strict):
    initial_cash: Decimal | None = Field(default=None, gt=0, le=1_000_000_000)


class SettingsRequest(_Strict):
    slippage_bps: float | None = Field(default=None, ge=0, le=100)
    brokerage_per_order: Decimal | None = Field(default=None, ge=0, le=1000)


class WatchlistRequest(_Strict):
    instrument_ids: list[UUID] = Field(max_length=50)


class QuoteOut(BaseModel):
    price: float
    time: str
    previous_close: float | None
    change: float | None
    change_percent: float | None
    source: str
    delayed: bool
    age_seconds: int


class MarketStatus(BaseModel):
    is_open: bool
    now: str
    session: str
    closes_at: str | None
    next_open: str | None


class PriceSource(BaseModel):
    name: str
    delayed: bool
    note: str


class AccountOut(BaseModel):
    id: str
    initial_cash: float
    cash: float
    blocked_cash: float
    available_cash: float
    invested: float
    holdings_value: float | None
    live_positions_value: float = Field(
        default=0, description="Open intraday positions of live paper sessions at their last price (a short is negative)."
    )
    unrealised_pnl: float | None
    realised_pnl: float
    total_charges: float
    equity: float | None
    total_pnl: float | None
    holdings_count: int
    all_priced: bool
    slippage_bps: float
    brokerage_per_order: float
    watchlist: list[str]
    reset_count: int
    last_reset_at: str | None
    created_at: str
    market: MarketStatus
    price_source: PriceSource
    simulation_only: bool = True


class OrderOut(BaseModel):
    id: str
    instrument_id: str
    symbol: str
    side: str
    order_type: str
    product: str
    quantity: int
    price: float | None
    trigger_price: float | None
    status: str
    status_message: str | None
    session_date: date
    after_market: bool
    placed_at: str
    triggered_at: str | None
    filled_at: str | None
    average_price: float | None
    reserved_amount: float | None
    source: str
    deployment_id: str | None = None
    note: str | None = None
    tags: list[str] = []


class FillOut(BaseModel):
    id: str
    order_id: str
    instrument_id: str
    symbol: str
    side: str
    quantity: int
    price: float
    quote_price: float
    quote_time: str
    trade_value: float
    charges: dict[str, float]
    total_charges: float
    net_amount: float
    realised_pnl: float | None
    filled_at: str


class HoldingOut(BaseModel):
    instrument_id: str
    symbol: str
    quantity: int
    average_price: float
    invested: float
    last_price: float | None
    quote: QuoteOut | None
    quote_problem: str | None
    market_value: float | None
    unrealised_pnl: float | None


class QuoteRow(BaseModel):
    instrument_id: str
    symbol: str
    name: str
    quote: QuoteOut | None
    problem: str | None


class PreviewOut(BaseModel):
    estimated_price: float | None
    estimated_value: float | None
    charges: dict[str, float] | None
    estimated_total: float | None
    available_cash: float
    quote: QuoteOut | None
    quote_problem: str | None
    session_date: date
    after_market: bool
    allowed: bool
    problem: str | None


class ChargeRate(BaseModel):
    key: str
    label: str
    rate: float
    applies_to: str
    basis: str


class ChargesTable(BaseModel):
    as_of: str
    product: str
    rates: list[ChargeRate]
    brokerage: str
    not_included: str


# --- P2 / P3 ------------------------------------------------------------------


class DeployRequest(_Strict):
    """Deploy a saved strategy (core template or no-code rules) to the paper account."""

    strategy_id: UUID
    instrument_id: UUID
    other_instrument_ids: list[UUID] = Field(default_factory=list, max_length=19)
    execution_config: dict | None = None
    quantity: int = Field(default=1, ge=1, le=1_000_000)
    capital: Decimal = Field(gt=0, le=1_000_000_000)
    loss_limit: float | None = Field(default=None, gt=0, lt=1)
    duration_days: int | None = Field(default=None, ge=1, le=365)


class FromValidationRequest(_Strict):
    """Start validation stage 5: the validated strategy on the paper account for 30 days."""

    capital: Decimal = Field(gt=0, le=1_000_000_000)
    loss_limit: float | None = Field(default=None, gt=0, lt=1)


class JournalRequest(_Strict):
    note: str | None = Field(default=None, max_length=1000)
    tags: list[str] = Field(default_factory=list, max_length=10)


class Performance(BaseModel):
    days: int
    start_value: float
    end_value: float
    total_return: float | None
    max_drawdown: float
    annualized_mean_return: float | None
    annualized_volatility: float | None
    sharpe_ratio: float | None
    null_reasons: dict[str, str]
    fills: int
    closed_trades: int
    winning_trades: int
    win_rate: float | None
    realised_pnl: float
    charges: float


class DeploymentOut(BaseModel):
    id: str
    name: str
    strategy_id: str | None
    strategy_key: str
    strategy_version: int | None
    validation_id: str | None
    parameters: dict
    rules: dict | None
    layout: str
    instruments: list[dict[str, str]]
    quantity: int
    capital: float
    loss_limit: float | None
    start_date: date
    end_date: date | None
    status: str
    status_reason: str | None
    last_processed_date: date | None
    cash: float
    holdings: dict[str, int]
    breaches: int
    created_at: str
    completed_at: str | None
    performance: Performance


class DeploymentDayOut(BaseModel):
    day: date
    closes: dict[str, float | None]
    signal: str | None
    allocations: dict[str, float] | None
    targets: dict[str, int]
    orders: list[dict]
    cash: float | None
    positions_value: float | None
    equity: float | None
    drawdown: float | None
    note: str | None


class DeploymentDetail(DeploymentOut):
    days: list[DeploymentDayOut]


class RunDueOut(BaseModel):
    through: date
    deployments: int
    days_processed: int
    snapshots: int


class SnapshotOut(BaseModel):
    day: date
    cash: float
    holdings_value: float
    equity: float
    note: str | None


class AccountPerformance(BaseModel):
    initial_cash: float
    snapshots: list[SnapshotOut]
    performance: Performance
    basis: list[str]
