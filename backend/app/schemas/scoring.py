"""Multi-factor scoring API (Phase 13)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import StrategyType
from app.schemas.validation.status import ValidationStatus

Direction = Literal["higher_is_better", "lower_is_better", "magnitude", "suitability"]


class ScoreRequest(BaseModel):
    weights: dict[str, dict[str, float]] | None = Field(
        default=None,
        description=(
            "Optional custom weights per core strategy, e.g. {\"momentum\": {\"trend_strength\": 2, "
            "\"relative_momentum\": 1, \"volatility_suitability\": 1}}. Every factor of a strategy "
            "must be given, each >= 0, not all 0. Not saved; strategies left out use the defaults."
        ),
    )


class FactorDefinition(BaseModel):
    name: str
    label: str
    raw: str = Field(description="What the raw value measures.")
    normalization: str = Field(description="How the raw value is normalised.")


class StrategyFactorInfo(BaseModel):
    name: str
    direction: Direction


class RegimeRule(BaseModel):
    trend_states: list[str] | None = Field(description="None: any trend state.")
    volatility_states: list[str] | None = Field(description="None: any volatility state.")
    rule: str


class StrategyScoringInfo(BaseModel):
    strategy_key: str
    factors: list[StrategyFactorInfo]
    default_weights: dict[str, float]
    regime_rule: RegimeRule


class ScoringDefinitions(BaseModel):
    method: list[str]
    windows: dict[str, int]
    bounds: dict[str, list[float]]
    directions: dict[str, str]
    factors: list[FactorDefinition]
    strategies: list[StrategyScoringInfo]


class RegimeSnapshot(BaseModel):
    model_number: int
    model_version: str
    instrument_symbol: str | None
    as_of: str
    code: str
    name: str
    volatility_state: str
    trend_state: str
    confidence: float


class Compatibility(BaseModel):
    status: Literal["COMPATIBLE", "NOT_COMPATIBLE", "UNKNOWN"]
    reason: str


class FactorScore(BaseModel):
    factor: str
    label: str
    # Feature 6: set for a Python strategy's result factors (what the number means).
    definition: str | None = None
    direction: Direction
    raw: float = Field(description="The measurement before normalisation.")
    normalized: float
    suitability: float = Field(description="The normalised value as a suitability in 0..1.")
    weight: float
    weight_share: float = Field(description="weight / sum of the strategy's weights.")
    contribution: float = Field(description="suitability x weight share; they add up to the composite.")


class ScoredInstrument(BaseModel):
    id: UUID
    symbol: str | None


class ScoredStrategy(BaseModel):
    strategy_id: UUID
    name: str
    strategy_type: StrategyType
    version: int
    is_active: bool
    status: Literal["SCORED", "UNSCORED"]
    reason: str | None = Field(description="Why it is not scored.")
    basis: Literal["factor_model", "backtest_results"] = Field(
        default="factor_model",
        description="How it was scored: a template's factor model, or (custom Python) "
        "the metrics of its latest backtest.",
    )
    strategy_key: str | None
    rank: int | None
    composite_score: float | None
    factors: list[FactorScore]
    as_of: str | None = Field(description="The last stored bar the factors used.")
    instruments: list[ScoredInstrument]
    source_execution_id: UUID | None = Field(description="The latest completed backtest.")
    source_completed_at: datetime | None
    regime_compatibility: Compatibility | None
    validation: ValidationStatus


class ScoringResult(BaseModel):
    regime: RegimeSnapshot | None = Field(description="The active regime model's current regime.")
    weights: dict[str, dict[str, float]] = Field(description="The weights used, per core strategy.")
    custom_weights: bool
    rows: list[ScoredStrategy] = Field(description="Scored strategies by rank, then the unscored ones.")


class StrategyRegimeFit(BaseModel):
    strategy_key: str
    rule: RegimeRule
    compatibility: Compatibility


class RegimeFit(BaseModel):
    regime: RegimeSnapshot | None
    strategies: list[StrategyRegimeFit]
