from decimal import Decimal

from pydantic import BaseModel, Field


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


class TargetPortfolioRequest(BaseModel):
    capital: Decimal = Field(gt=0)
    candidates: list[StrategyCandidateInput] = Field(min_length=1)
    regime: str | None = None
    limits: PortfolioRiskLimitsInput | None = None


class PortfolioHoldingInput(BaseModel):
    quantity: int = Field(ge=0)
    price: Decimal = Field(ge=0)


class PortfolioRebalanceRequest(BaseModel):
    cash: Decimal = Field(ge=0)
    holdings: dict[str, PortfolioHoldingInput]
    prices: dict[str, Decimal]
    candidates: list[StrategyCandidateInput] = Field(min_length=1)
    regime: str | None = None
    limits: PortfolioRiskLimitsInput | None = None
    minimum_trade_value: Decimal = Field(default=Decimal("0.00"), ge=0)


class CreatePortfolioRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    initial_capital: Decimal = Field(gt=0)
    description: str | None = None


class UpdatePortfolioStateRequest(BaseModel):
    cash: Decimal = Field(ge=0)
    holdings: dict[str, PortfolioHoldingInput] = Field(default_factory=dict)


class CreatePortfolioRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    initial_capital: Decimal = Field(gt=0)
    description: str | None = None


class UpdatePortfolioStateRequest(BaseModel):
    cash: Decimal = Field(ge=0)
    holdings: dict[str, PortfolioHoldingInput] = Field(default_factory=dict)
