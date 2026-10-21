"""Portfolio backtest against Nifty 50 (Feature 4): requests and results."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.enums import ExecutionStatus
from app.schemas.portfolio.responses import BindingLimit
from app.schemas.validation.report import RegimeModelRef
from app.schemas.validation.status import ValidationStatus


class BacktestLimits(BaseModel):
    """Risk limits as shares of the portfolio's value on each rebalance day."""

    cash_reserve: float = Field(default=0.0, ge=0, le=0.9, description="Share always kept in cash.")
    max_strategy_weight: float = Field(default=1.0, gt=0, le=1, description="Most any one strategy may get.")
    max_asset_weight: float = Field(
        default=1.0, gt=0, le=1, description="Most any one instrument may get (strategies on it together)."
    )


class CreatePortfolioBacktestRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    strategy_ids: list[UUID] = Field(min_length=1, max_length=20)
    benchmark_instrument_id: UUID = Field(description="Nifty 50 (an NSE index, e.g. NIFTY50).")
    start_date: date
    end_date: date
    frequency: Literal["WEEKLY", "MONTHLY"] = "WEEKLY"
    capital: float = Field(default=1_000_000, gt=0, le=1e12)
    brokerage_rate: float = Field(default=0.0003, ge=0, le=0.05, description="Of the traded value.")
    slippage_bps: float = Field(default=5, ge=0, le=1000)
    limits: BacktestLimits = Field(default_factory=BacktestLimits)
    regime_filter: bool = Field(
        default=True, description="Leave out strategies whose rule does not suit the regime of the day."
    )
    regime_model_id: UUID | None = Field(
        default=None, description="With the regime filter: the model (default: the active one)."
    )
    sixty_forty: bool = Field(default=False, description="Also compare with 60% Nifty 50 / 40% debt.")
    require_validated: bool = Field(
        default=False,
        description="Feature 5: only strategies with a passing validation of their current version.",
    )

    @model_validator(mode="after")
    def check(self):
        if self.end_date <= self.start_date:
            raise ValueError("end_date must be after start_date.")
        if len(set(self.strategy_ids)) != len(self.strategy_ids):
            raise ValueError("Each strategy can be chosen only once.")
        return self


class Headline(BaseModel):
    portfolio_return: float | None
    nifty_return: float | None
    sharpe_met: bool
    drawdown_met: bool


class PortfolioBacktestSummary(BaseModel):
    id: UUID
    name: str
    status: ExecutionStatus
    start_date: date
    end_date: date
    frequency: str
    strategy_count: int
    benchmark_symbol: str | None
    regime_filter: bool
    error_message: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    headline: Headline | None = None


class SleeveSetting(BaseModel):
    strategy_id: str
    name: str
    strategy_key: str
    parameters: dict
    instrument_id: str
    symbol: str
    asset: str
    source_backtest_id: str
    initial_capital: float
    quantity: int
    slippage_bps: float
    brokerage_rate: float
    validation: ValidationStatus | None = None


class ExcludedStrategy(BaseModel):
    strategy_id: str
    name: str
    reason: str


class PortfolioBacktestDetail(PortfolioBacktestSummary):
    benchmark_instrument_id: str | None
    capital: float
    brokerage_rate: float
    slippage_bps: float
    limits: BacktestLimits
    sixty_forty: bool
    strategies: list[SleeveSetting]
    excluded: list[ExcludedStrategy]
    regime_model: RegimeModelRef | None
    require_validated: bool = False
    hindsight: list[str] = Field(
        default_factory=list,
        description="Strategies validated on data from inside the period (choosing them uses hindsight).",
    )


class Objective(BaseModel):
    target: float
    portfolio: float | None
    benchmark: float | None
    value: float | None
    met: bool
    reason: str | None
    rule: str


class Objectives(BaseModel):
    sharpe_improvement: Objective
    drawdown_reduction: Objective


class SeriesMetrics(BaseModel):
    cagr: float | None
    annualized_volatility: float | None
    downside_deviation: float | None
    sharpe_ratio: float | None
    sortino_ratio: float | None
    calmar_ratio: float | None
    max_drawdown: float | None
    max_drawdown_duration_bars: int | None
    total_return: float | None
    final_value: float


class Relative(BaseModel):
    alpha: float | None
    beta: float | None
    correlation: float | None
    tracking_error: float | None
    information_ratio: float | None


class RegimeOnDay(BaseModel):
    code: str
    name: str
    volatility_state: str
    trend_state: str
    as_of: str


class RebalanceStrategy(BaseModel):
    strategy_id: str
    name: str
    score: float | None
    factors: dict[str, float] | None
    excluded: str | None
    weight: float


class RebalanceEntry(BaseModel):
    day: str
    regime: RegimeOnDay | None
    strategies: list[RebalanceStrategy]
    cash_weight: float
    turnover: float
    cost: float
    value_before: float
    value_after: float
    binding_limits: list[BindingLimit]
    note: str | None


class SleeveSummary(BaseModel):
    strategy_id: str
    name: str
    symbol: str
    trades: int
    first_day: str | None


class PortfolioInSample(BaseModel):
    """Days of the run inside the regime model's training period (classified in-sample)."""

    days: int
    of_days: int
    flag: str | None


class BenchmarkRef(BaseModel):
    instrument_id: str
    symbol: str | None


class PortfolioBacktestResults(BaseModel):
    version: str
    days: list[str]
    series: dict[str, list[float]] = Field(description="portfolio, nifty, equal_weight and maybe sixty_forty.")
    drawdowns: dict[str, list[float]]
    metrics: dict[str, SeriesMetrics]
    null_reasons: dict[str, dict[str, str]]
    relative: Relative
    relative_null_reasons: dict[str, str]
    objectives: Objectives
    rebalances: list[RebalanceEntry]
    rebalance_count: int
    strategy_names: dict[str, str]
    sleeves: list[SleeveSummary]
    regime_model: RegimeModelRef | None
    regime_in_sample: PortfolioInSample | None
    notes: list[str]
    benchmark: BenchmarkRef
