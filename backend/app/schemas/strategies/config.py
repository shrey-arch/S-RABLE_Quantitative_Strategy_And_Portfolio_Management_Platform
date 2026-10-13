from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class IndicatorConfig(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)
    parameters: dict[str, Any]


class ValueOperand(BaseModel):
    type: Literal["value"]
    value: str | int | float | bool


class IndicatorOperand(BaseModel):
    type: Literal["indicator"]
    name: str = Field(min_length=1)


class Condition(BaseModel):
    left: ValueOperand | IndicatorOperand
    operator: Literal["<", "<=", ">", ">=", "=="]
    right: ValueOperand | IndicatorOperand


class StrategyConfig(BaseModel):
    parameters: dict[str, str | int | float | bool]
    indicators: list[IndicatorConfig]
    entry_conditions: list[Condition]
    exit_conditions: list[Condition]

    @model_validator(mode="after")
    def validate_strategy_references(self):
        indicator_names = {
            indicator.name
            for indicator in self.indicators
        }

        if len(indicator_names) != len(self.indicators):
            raise ValueError("Indicator names must be unique")

        for condition in self.entry_conditions + self.exit_conditions:
            for operand in (condition.left, condition.right):
                if operand.type == "indicator":
                    if operand.name not in indicator_names:
                        raise ValueError(
                            f"Unknown indicator reference: {operand.name}"
                        )

        return self
