from typing import Literal

from pydantic import BaseModel


class StrategyParameterInfo(BaseModel):
    """One constructor parameter of a built-in strategy."""

    name: str
    type: str | None
    required: bool
    default: bool | int | float | str | None = None


class StrategyRegistryEntry(BaseModel):
    """A built-in strategy from StrategyRegistry (read-only)."""

    strategy_key: str
    parameters: list[StrategyParameterInfo]
    required_inputs: list[str]
    instruments: Literal["single", "pair", "universe"] = "single"


class StrategyParameterValidationRequest(BaseModel):
    parameters: dict[str, bool | int | float | str]


class StrategyParameterValidationResponse(BaseModel):
    strategy_key: str
    effective_parameters: dict[str, bool | int | float | str]