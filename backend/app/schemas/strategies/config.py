from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, model_validator

from app.quant.indicators.catalogue import (
    INDICATORS,
    IndicatorValidationError,
    validate_indicator,
)

PRICE_FIELDS = ("open", "high", "low", "close", "volume")


class IndicatorConfig(BaseModel):
    name: str = Field(min_length=1)
    type: str = Field(min_length=1)
    parameters: dict[str, Any]

    @model_validator(mode="after")
    def validate_against_catalogue(self):
        """The type must be in GET /indicators; parameters are checked and completed."""
        try:
            spec, values = validate_indicator(self.type, self.parameters)
        except IndicatorValidationError as exc:
            raise ValueError(f"Indicator '{self.name}': {exc}") from exc
        self.type = spec.key
        self.parameters = values
        return self


class ValueOperand(BaseModel):
    type: Literal["value"]
    value: str | int | float | bool


class IndicatorOperand(BaseModel):
    """One line of a defined indicator. `output` names the line (GET /indicators
    lists each indicator's outputs). It may be left out only for indicators with a
    single line; it is then filled in, so the stored config is always explicit."""

    type: Literal["indicator"]
    name: str = Field(min_length=1)
    output: str | None = None


class PriceOperand(BaseModel):
    """A field of the current bar."""

    type: Literal["price"]
    field: Literal["open", "high", "low", "close", "volume"]


Operand = Annotated[
    Union[ValueOperand, IndicatorOperand, PriceOperand],
    Field(discriminator="type"),
]


class Condition(BaseModel):
    left: Operand
    operator: Literal["<", "<=", ">", ">=", "=="]
    right: Operand


class StrategyConfig(BaseModel):
    parameters: dict[str, str | int | float | bool]
    indicators: list[IndicatorConfig]
    entry_conditions: list[Condition]
    exit_conditions: list[Condition]

    @model_validator(mode="after")
    def validate_strategy_references(self):
        outputs_by_name = {
            indicator.name: INDICATORS[indicator.type].outputs
            for indicator in self.indicators
        }

        if len(outputs_by_name) != len(self.indicators):
            raise ValueError("Indicator names must be unique")

        for condition in self.entry_conditions + self.exit_conditions:
            for operand in (condition.left, condition.right):
                if operand.type != "indicator":
                    continue
                outputs = outputs_by_name.get(operand.name)
                if outputs is None:
                    raise ValueError(f"Unknown indicator reference: {operand.name}")
                if operand.output is None:
                    if len(outputs) > 1:
                        raise ValueError(
                            f"{operand.name} has several lines; choose one of: "
                            f"{', '.join(outputs)}."
                        )
                    operand.output = outputs[0]
                elif operand.output not in outputs:
                    raise ValueError(
                        f"{operand.name} has no line '{operand.output}'. "
                        f"Its lines are: {', '.join(outputs)}."
                    )

        return self
