"""GET /executions/{id}/results: everything the results page shows."""

from uuid import UUID

from pydantic import BaseModel, Field


class ResultsBasis(BaseModel):
    """How the ratios are annualised."""

    periods_per_year: int = Field(description="Bars per year used to annualise (252 trading days).")
    risk_free_rate_annual: float = Field(description="Risk-free rate a year, as a fraction.")
    risk_free_rate_per_period: float = Field(description="The same rate per bar, compounded.")
    return_frequency: str = Field(description="What one return is measured over.")
    cagr_year_days: float = Field(description="Calendar days in a year for CAGR.")


class ResultsSummary(BaseModel):
    initial_capital: float
    final_capital: float
    net_profit: float
    total_return: float
    cagr: float | None
    annualized_volatility: float | None
    downside_deviation: float | None
    sharpe_ratio: float | None
    sortino_ratio: float | None
    calmar_ratio: float | None
    max_drawdown: float | None
    max_drawdown_duration_bars: int | None
    max_drawdown_peak_at: str | None
    max_drawdown_trough_at: str | None
    bar_count: int
    first_bar_at: str
    last_bar_at: str


class TradeStats(BaseModel):
    fill_count: int
    round_trip_count: int = Field(description="Closed trades (open to flat).")
    open_position_count: int
    winning_trades: int
    losing_trades: int
    win_rate: float | None
    average_gain: float | None
    average_loss: float | None
    profit_factor: float | None
    total_charges: float
    total_brokerage: float


class EquityPoint(BaseModel):
    timestamp: str
    portfolio_value: float
    drawdown: float = Field(description="Value / running peak - 1 (0 or below).")


class BenchmarkPoint(BaseModel):
    timestamp: str
    portfolio_value: float


class Benchmark(BaseModel):
    kind: str
    instrument_id: str
    equity_curve: list[BenchmarkPoint]
    total_return: float


class MonthlyReturn(BaseModel):
    month: str = Field(description="YYYY-MM (IST).")
    value: float | None


class RoundTrip(BaseModel):
    instrument_id: str
    direction: str
    quantity: int
    entry_timestamp: str
    entry_price: float
    exit_timestamp: str | None
    exit_price: float | None
    gross_pnl: float | None
    charges: float
    net_pnl: float | None
    return_: float | None = Field(alias="return")
    is_open: bool

    model_config = {"populate_by_name": True, "serialize_by_alias": True}


class SimulatedOrder(BaseModel):
    timestamp: str
    instrument_id: str
    side: str
    order_type: str
    quantity: int
    status: str
    reference_price: float | None = Field(description="The bar's close the order was sent at.")
    fill_price: float


class SimulatedFill(BaseModel):
    timestamp: str
    instrument_id: str
    side: str
    quantity: int
    price: float
    brokerage: float
    total_charges: float
    realized_pnl: float
    closed_quantity: int
    opened_quantity: int


class SimulatedPosition(BaseModel):
    instrument_id: str
    direction: str
    quantity: int
    average_price: float
    last_price: float | None
    market_value: float | None
    unrealized_pnl: float | None


class SimulatedRecords(BaseModel):
    """This run's simulated orders, fills and end positions. Nothing was traded."""

    orders: list[SimulatedOrder]
    fills: list[SimulatedFill]
    positions: list[SimulatedPosition]
    ending_cash: float


class ResultsConfiguration(BaseModel):
    strategy_id: UUID
    strategy_name: str | None
    strategy_key: str | None
    strategy_version: int | None = Field(description="Version when the run was submitted.")
    current_strategy_version: int | None
    parameters: dict
    instrument_ids: list[str]
    timeframe: str
    initial_capital: float
    quantity: int | None
    slippage_bps: float | None
    brokerage_rate: float | None
    requested_start: str | None
    requested_end: str | None
    engine_version: str | None
    rules: dict | None = Field(
        default=None,
        description="A no-code strategy's rules as they were when the run was submitted.",
    )


class ProvenanceEntry(BaseModel):
    instrument_id: str | None
    provider: str | None
    frequency: str | None
    requested_start_date: str | None
    requested_end_date: str | None
    row_count: int | None
    cache_hit: bool | None
    dataset_cache_key: str | None
    data_fingerprint: str | None
    data_version: str | None
    data_acquired_at: str | None


class ResultsProvenance(BaseModel):
    datasets: list[ProvenanceEntry]
    aligned_rows: int | None = Field(description="Bars all instruments share (multi-instrument runs).")


class ExecutionResultsResponse(BaseModel):
    execution_id: UUID
    basis: ResultsBasis
    summary: ResultsSummary
    trade_stats: TradeStats
    null_reasons: dict[str, str] = Field(description="Why a value is null, by field name.")
    equity_curve: list[EquityPoint]
    benchmark: Benchmark | None
    benchmark_unavailable_reason: str | None
    monthly_returns: list[MonthlyReturn]
    round_trips: list[RoundTrip]
    records: SimulatedRecords
    configuration: ResultsConfiguration
    provenance: ResultsProvenance
