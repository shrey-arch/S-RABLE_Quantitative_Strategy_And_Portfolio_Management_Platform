"""The validation report (GET /validations/{id}), as stored by the pipeline."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import ExecutionStatus
from app.schemas.executions.response import ExecutionErrorInfo

StageStatus = Literal["NOT_RUN", "RUNNING", "PASS", "FAIL", "ERROR", "PLANNED"]
VerdictStatus = Literal["PENDING", "PASS", "FAIL", "INCOMPLETE", "VALIDATED"]


class Check(BaseModel):
    id: str
    label: str
    operator: Literal[">", ">=", "<", "<="]
    threshold: float
    value: float | None
    passed: bool
    unit: Literal["ratio", "fraction", "count", "p_value"]
    explanation: str
    reason: str | None = Field(default=None, description="Why the value is missing.")


class ThresholdDefinition(BaseModel):
    stage: str
    id: str
    label: str
    operator: Literal[">", ">=", "<", "<="]
    threshold: float
    unit: Literal["ratio", "fraction", "count", "p_value"]


class EquityPoint(BaseModel):
    timestamp: str
    portfolio_value: float


class YearReturn(BaseModel):
    year: int
    return_: float = Field(alias="return")

    model_config = {"populate_by_name": True}


class BacktestStageMetrics(BaseModel):
    initial_capital: float
    final_capital: float
    total_return: float
    cagr: float | None
    sharpe_ratio: float | None
    sortino_ratio: float | None
    annualized_volatility: float | None
    max_drawdown: float | None
    trade_count: int
    bars: int
    positive_year_share: float


class SpanMetrics(BaseModel):
    bars: int
    total_return: float
    annualized_mean_return: float | None
    sharpe_ratio: float | None
    max_drawdown: float | None
    trade_count: int
    null_reasons: dict[str, str] = {}


class WalkForwardWindow(BaseModel):
    index: int
    train_start: str
    train_end: str
    validation_start: str
    validation_end: str
    test_start: str
    test_end: str
    train_bars: int
    validation_bars: int
    test_bars: int
    parameters: dict
    candidates_tested: int
    in_sample: SpanMetrics
    out_of_sample: SpanMetrics
    retention: float | None
    retention_reason: str | None


class ParameterChoice(BaseModel):
    choice: str
    windows: int
    share: float


class WalkForwardSummary(BaseModel):
    window_count: int
    mean_in_sample_return: float | None
    mean_out_of_sample_return: float | None
    retention: float | None
    retention_reason: str | None
    mean_in_sample_sharpe: float | None
    mean_out_of_sample_sharpe: float | None
    mean_test_return: float
    median_test_return: float
    test_return_std: float
    positive_test_window_rate: float
    parameter_stability: list[ParameterChoice]


class WalkForwardSettingsUsed(BaseModel):
    train_bars: int
    validation_bars: int
    test_bars: int
    step_bars: int
    parameter_grid: dict
    candidates: int
    selection: str


class RegimeRow(BaseModel):
    key: str
    name: str
    days: int
    share: float
    total_return: float | None
    annualized_mean_return: float | None
    annualized_volatility: float | None
    max_drawdown: float | None
    trade_count: int
    # Model source (Feature 3): the regime's code, and whether it has enough days to be judged.
    code: str | None = None
    judged: bool | None = None


class RegimePeriod(BaseModel):
    regime: str
    start: str
    end: str
    bars: int


class RegimeModelRef(BaseModel):
    """The market regime model a stage-3 split used (recorded for reproducibility)."""

    id: str
    number: int
    name: str
    kind: str
    kind_name: str
    version: str
    training_start: str | None
    training_end: str | None
    in_sample_end: str | None = Field(
        default=None,
        description="The last day the model saw in training (a supervised model's labels look ahead).",
    )
    instrument_id: str | None
    instrument_symbol: str | None
    horizon_days: int | None
    random_state: int | None = None


class RegimeMethod(BaseModel):
    method: str
    warm_up_bars: int
    source: Literal["rule_based", "model"] = "rule_based"
    # Rule-based only.
    trend_window: int | None = None
    volatility_window: int | None = None
    volatility_threshold: float | None = None
    # Model only.
    model: RegimeModelRef | None = None
    min_days: int | None = None


class DimensionRegimes(BaseModel):
    key: str
    name: str
    rows: list[RegimeRow]
    periods: list["RegimePeriod"]


class UnclassifiedReason(BaseModel):
    reason: Literal["warm_up", "no_reference_bar"]
    description: str
    days: int


class Unclassified(BaseModel):
    days: int
    reasons: list[UnclassifiedReason]
    periods: list["RegimePeriod"]


class InsufficientRegime(BaseModel):
    key: str
    name: str
    days: int


class InSample(BaseModel):
    days: int
    of_days: int
    training_start: str | None
    training_end: str | None = Field(description="The last day the model saw in training.")
    flag: str | None = Field(description="Set when some backtest days were in the model's training period.")


class Percentiles(BaseModel):
    p05: float
    p25: float
    p50: float
    p75: float
    p95: float


class Distribution(BaseModel):
    mean: float
    median: float
    percentiles: Percentiles


class ReturnDistribution(Distribution):
    simulated_outcome_interval_90: list[float]
    probability_of_loss: float


class Histogram(BaseModel):
    edges: list[float]
    counts: list[int]


class Histograms(BaseModel):
    cumulative_return: Histogram
    maximum_drawdown: Histogram


class Bootstrap(BaseModel):
    method: str
    input_series: str
    assumptions: list[str]
    seed: int
    simulations: int
    periods: int
    initial_capital: float
    cumulative_return: ReturnDistribution
    final_value: Distribution
    maximum_drawdown: Distribution
    histograms: Histograms


class Significance(BaseModel):
    test: str
    null_hypothesis: str
    alternative_hypothesis: str
    assumptions: list[str]
    observed_mean_return: float
    permutations: int
    seed: int
    p_value: float
    significant_at_0_05: bool


class StageBase(BaseModel):
    key: str
    name: str
    status: StageStatus
    checks: list[Check] = []
    reason: str | None = None
    error: str | None = None


class BacktestStage(StageBase):
    metrics: BacktestStageMetrics | None = None
    null_reasons: dict[str, str] = {}
    yearly_returns: list[YearReturn] = []
    equity_curve: list[EquityPoint] = []


class WalkForwardStage(StageBase):
    settings: WalkForwardSettingsUsed | None = None
    windows: list[WalkForwardWindow] = []
    summary: WalkForwardSummary | None = None


class RegimeStressStage(StageBase):
    method: RegimeMethod | None = None
    regimes: list[RegimeRow] = []
    periods: list[RegimePeriod] = []
    labelled_days: int | None = None
    # Model source only (Feature 3).
    dimensions: list[DimensionRegimes] | None = None
    unclassified: Unclassified | None = None
    insufficient: list[InsufficientRegime] | None = None
    in_sample: InSample | None = None


class MonteCarloStage(StageBase):
    resampled_series: str | None = None
    bootstrap: Bootstrap | None = None
    significance: Significance | None = None


class PaperStageInfo(BaseModel):
    """Stage 5: the paper deployment running the strategy (Feature 1)."""

    deployment_id: str
    status: str
    start_date: str
    end_date: str | None
    days_done: int
    days_planned: int | None
    capital: float
    equity: float | None
    total_return: float | None
    max_drawdown: float | None
    paper_annualized_mean_return: float | None
    backtest_annualized_mean_return: float | None
    retention: float | None
    loss_limit: float | None
    breaches: int
    fills: int


class PaperTradingStage(StageBase):
    paper: PaperStageInfo | None = None


class Stages(BaseModel):
    backtest: BacktestStage
    walk_forward: WalkForwardStage
    regime_stress: RegimeStressStage
    monte_carlo: MonteCarloStage
    paper_trading: PaperTradingStage


class Verdict(BaseModel):
    status: VerdictStatus
    reason: str


class ValidationConfiguration(BaseModel):
    strategy_id: UUID
    strategy_name: str | None
    strategy_key: str | None
    strategy_version: int | None
    current_strategy_version: int | None
    parameters: dict
    rules: dict | None
    instrument_ids: list[str]
    timeframe: str
    initial_capital: float
    quantity: int | None
    slippage_bps: float | None
    brokerage_rate: float | None
    requested_start: str | None
    requested_end: str | None
    walk_forward: dict
    regimes: dict
    monte_carlo: dict
    engine_version: str | None
    validation_version: str | None
    source_execution_id: str | None


class ValidationSummary(BaseModel):
    """One validation run in the history list."""

    id: UUID
    status: ExecutionStatus
    strategy_id: UUID
    strategy_name: str | None
    instrument_id: UUID | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    verdict: Verdict
    stage_statuses: dict[str, StageStatus]
    source_execution_id: str | None
    error: ExecutionErrorInfo | None = None


class ValidationReport(ValidationSummary):
    configuration: ValidationConfiguration
    stages: Stages
    thresholds: list[ThresholdDefinition]
    thresholds_source: str
    basis: list[str]
    data_provenance: dict | None
    bars: int | None
