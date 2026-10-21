"""Responses of /portfolio. Money and weights are decimal strings, as stored;
weights are fractions of 1 with six decimals. Every value is simulated."""

from uuid import UUID

from pydantic import BaseModel

from app.schemas.validation.status import ValidationStatus


class PortfolioSummary(BaseModel):
    id: UUID
    name: str
    description: str | None
    initial_capital: str
    cash: str
    invested_value: str
    total_equity: str
    holdings_count: int
    simulation_only: bool = True


class SavedHolding(BaseModel):
    asset: str
    quantity: int
    # The valuation price saved with the holding.
    price: str
    # Average cost: blended on every saved increase in quantity; sells keep it.
    average_price: str
    market_value: str
    weight: str


class PortfolioAccount(BaseModel):
    id: UUID
    name: str
    description: str | None
    initial_capital: str
    cash: str
    invested_value: str
    total_equity: str
    # Each holding's market value / total equity; cash_weight is the rest, so
    # the weights add up to exactly 1.
    allocation_weights: dict[str, str]
    cash_weight: str
    holdings: list[SavedHolding]
    simulation_only: bool = True


class BindingLimit(BaseModel):
    limit: str
    value: str
    # Strategies (their keys in strategy_weights) or assets the limit reduced.
    affected: list[str]
    detail: str


class TargetPosition(BaseModel):
    # Key of the position: the strategy id (saved strategies) or template key.
    strategy: str
    strategy_id: UUID | None = None
    name: str | None = None
    strategy_key: str | None = None
    asset: str | None
    score: float
    amount: str
    weight: str
    # Saved strategies: the validation status it was allocated with.
    validation: ValidationStatus | None = None


class ExcludedStrategy(BaseModel):
    strategy_id: UUID
    name: str
    strategy_key: str | None
    asset: str | None
    score: float | None
    reason: str
    validation: ValidationStatus | None = None


class ChosenRegime(BaseModel):
    code: str
    name: str
    volatility_state: str
    trend_state: str
    model_number: int


class TargetPortfolioResponse(BaseModel):
    capital: str
    regime: str | None
    regime_label: ChosenRegime | None = None
    invested_capital: str
    cash_reserve: str
    positions: list[TargetPosition]
    excluded: list[ExcludedStrategy] = []
    target_values: dict[str, str]
    # amount / capital per position; asset weights add the positions holding
    # the same asset; cash_weight = 1 - sum(strategy weights).
    strategy_weights: dict[str, str]
    asset_weights: dict[str, str]
    cash_weight: str
    binding_limits: list[BindingLimit]
    # Saved strategies: whether only validated strategies could be allocated.
    require_validated: bool | None = None
    simulation_only: bool = True


class StateHolding(BaseModel):
    asset: str
    quantity: int
    price: str
    market_value: str


class CurrentState(BaseModel):
    cash: str
    invested_value: str
    total_equity: str
    holdings: list[StateHolding]


class RebalanceTrade(BaseModel):
    asset: str
    side: str
    quantity: int
    price: str
    value: str


class Rebalancing(BaseModel):
    starting_cash: str
    ending_cash: str
    target_values: dict[str, str]
    trades: list[RebalanceTrade]


class RebalanceAsset(BaseModel):
    asset: str
    price: str
    current_quantity: int
    current_value: str
    current_weight: str
    target_value: str
    target_weight: str
    action: str
    trade_quantity: int
    trade_value: str
    ending_quantity: int
    ending_value: str


class EndingHolding(BaseModel):
    asset: str
    quantity: int
    price: str


class EndingState(BaseModel):
    cash: str
    invested_value: str
    total_equity: str
    holdings: list[EndingHolding]


class UsedPrice(BaseModel):
    asset: str
    price: str
    # given: sent with the request; holding: the held asset's own price;
    # latest_close: filled in from the latest stored daily close (as_of).
    source: str
    as_of: str | None = None


class RebalancePlanResponse(BaseModel):
    current_state: CurrentState
    target: TargetPortfolioResponse
    rebalancing: Rebalancing
    # Current vs target per asset with the proposed trade, and the state if
    # every trade were filled at its price (what "apply" saves).
    assets: list[RebalanceAsset] = []
    ending_state: EndingState | None = None
    prices: list[UsedPrice] = []
    simulation_only: bool = True


class AssetPrice(BaseModel):
    asset: str
    instrument_id: UUID | None
    price: str | None
    # Timestamp of the stored daily bar the price is its close of.
    as_of: str | None
    reason: str | None
