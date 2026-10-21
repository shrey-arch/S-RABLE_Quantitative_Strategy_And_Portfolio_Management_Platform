from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class StrategyCandidateInput(BaseModel):
    strategy: str = Field(min_length=1)
    asset: str | None = None
    factors: dict[str, float]
    weights: dict[str, float] | None = None
    compatible_regimes: list[str] | None = None


class PortfolioRiskLimitsInput(BaseModel):
    cash_reserve: Decimal = Field(default=Decimal("0.00"), ge=0)
    max_strategy_weight: Decimal = Field(default=Decimal("1.00"), ge=0, le=1)
    max_asset_weight: Decimal = Field(default=Decimal("1.00"), ge=0, le=1)
    max_invested_capital: Decimal | None = Field(default=None, ge=0)


class _ChooseCandidates(BaseModel):
    """Candidates are either the user's saved strategies (strategy_ids) or raw
    template candidates with factor values (candidates), never both."""

    candidates: list[StrategyCandidateInput] | None = None
    strategy_ids: list[UUID] | None = None
    # With strategy_ids: a regime code (R1, R2, ...) of the active regime model.
    # With candidates: the regime name matched against compatible_regimes.
    regime: str | None = None
    # Feature 5, with strategy_ids: only strategies with an eligible validation
    # (VALIDATED or VALIDATED_PAPER_PENDING) are allocated. Off: include the
    # others too (for experiments).
    require_validated: bool = True

    @model_validator(mode="after")
    def _one_source(self):
        if bool(self.candidates) == bool(self.strategy_ids):
            raise ValueError(
                "Give either strategy_ids (your saved strategies) or candidates, "
                "with at least one item."
            )
        return self


class TargetPortfolioRequest(_ChooseCandidates):
    capital: Decimal = Field(gt=0)
    limits: PortfolioRiskLimitsInput | None = None


class PortfolioHoldingInput(BaseModel):
    quantity: int = Field(ge=0)
    price: Decimal = Field(ge=0)


class PortfolioRebalanceRequest(_ChooseCandidates):
    cash: Decimal = Field(ge=0)
    holdings: dict[str, PortfolioHoldingInput]
    prices: dict[str, Decimal]
    limits: PortfolioRiskLimitsInput | None = None
    minimum_trade_value: Decimal = Field(default=Decimal("0.00"), ge=0)


class CreatePortfolioRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    initial_capital: Decimal = Field(gt=0)
    description: str | None = None


class UpdatePortfolioStateRequest(BaseModel):
    cash: Decimal = Field(ge=0)
    holdings: dict[str, PortfolioHoldingInput] = Field(default_factory=dict)
