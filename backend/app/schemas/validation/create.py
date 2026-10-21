from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.backtesting.create import CreateBacktestRequest


class WalkForwardSettings(BaseModel):
    train_bars: int = Field(
        default=252,
        ge=1,
        le=5000,
        description="Bars before each validation span. They are warm-up only (nothing is traded).",
    )
    validation_bars: int = Field(
        default=63,
        ge=5,
        le=5000,
        description="In-sample span: parameters are chosen here.",
    )
    test_bars: int = Field(
        default=63,
        ge=5,
        le=5000,
        description="Out-of-sample span: the chosen parameters are tested here, unchanged.",
    )
    step_bars: int | None = Field(
        default=None,
        ge=1,
        le=5000,
        description="Bars between window starts. Default: test_bars (test spans do not overlap).",
    )
    parameter_grid: dict[str, list[int | float]] = Field(
        default_factory=dict,
        description=(
            "Optional candidate values per strategy parameter, e.g. {\"lookback\": [10, 20, 30]}. "
            "Every combination is tried on each validation span (at most 25). Empty: the "
            "strategy's own parameters on every window. Not allowed for no-code strategies."
        ),
    )

    @field_validator("parameter_grid")
    @classmethod
    def check_grid(cls, grid):
        for name, values in grid.items():
            if not 1 <= len(values) <= 10:
                raise ValueError(f"{name}: give between 1 and 10 values.")
            if len(set(values)) != len(values):
                raise ValueError(f"{name}: each value can be given only once.")
            if any(isinstance(v, bool) for v in values):
                raise ValueError(f"{name}: values must be numbers.")
        return grid


class RegimeSettings(BaseModel):
    source: str = Field(
        default="rule_based",
        pattern="^(rule_based|model)$",
        description=(
            "Where the regime labels come from: rule_based (from the instrument's prices) or "
            "model (the market regime model's classification of each day, Feature 3)."
        ),
    )
    model_id: UUID | None = Field(
        default=None,
        description="source = model: the regime model to use (default: the active model).",
    )
    trend_window: int = Field(
        default=200, ge=20, le=500, description="Days of the trend average (bull/bear)."
    )
    volatility_window: int = Field(
        default=20, ge=5, le=250, description="Days of the volatility estimate (high/low)."
    )


class MonteCarloSettings(BaseModel):
    simulations: int = Field(
        default=1000,
        ge=100,
        le=10000,
        description="Bootstrap paths, and sign-flip permutations of the significance test.",
    )
    seed: int = Field(
        default=42,
        ge=0,
        le=2**31 - 1,
        description="Random seed: the same seed and data give the same results.",
    )


class CreateValidationRequest(CreateBacktestRequest):
    """A backtest request plus the settings of the validation stages."""

    walk_forward: WalkForwardSettings = Field(default_factory=WalkForwardSettings)
    regimes: RegimeSettings = Field(default_factory=RegimeSettings)
    monte_carlo: MonteCarloSettings = Field(default_factory=MonteCarloSettings)
    source_execution_id: UUID | None = Field(
        default=None,
        description="Optional: the backtest this validation was started from (shown as a link).",
    )
