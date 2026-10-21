"""A no-code strategy: the rules saved by the builder (StrategyConfig v1), run bar by bar.

Long only:
- while flat, when every entry condition holds at a bar's close: BUY (hold the quantity);
- while holding, when every exit condition holds: EXIT (back to flat);
- otherwise HOLD. With no exit conditions the position is held to the end.

A condition whose value is not available yet (an indicator still warming up) does
not hold, so nothing is traded before every value it needs exists.

Indicators come from the catalogue (app.quant), as on the charts. They are computed
once over the run's data (prepare) and read at each bar. Every catalogue indicator is
causal - its value at a bar uses only that bar and earlier ones (tests check this) -
so this is the same as computing them bar by bar on the data seen so far, only faster.
"""

from __future__ import annotations

import math
import operator
from typing import Any

import pandas as pd
from pydantic import ValidationError

from app.quant.indicators.catalogue import INDICATORS, compute_indicator
from app.schemas.strategies.config import StrategyConfig
from app.strategies.base import Strategy
from app.strategies.context import StrategyContext
from app.strategies.signal import SignalAction, StrategySignal

RULES_KEY = "no_code_rules"

OPERATORS = {
    "<": operator.lt,
    "<=": operator.le,
    ">": operator.gt,
    ">=": operator.ge,
    "==": operator.eq,
}


def _first_error(exc: ValidationError) -> str:
    error = exc.errors()[0]
    message = str(error.get("msg", "Invalid rules."))
    return message.removeprefix("Value error, ")


class RuleStrategy(Strategy):
    strategy_key = RULES_KEY

    def __init__(self, config: dict[str, Any]):
        try:
            parsed = StrategyConfig.model_validate(config or {})
        except ValidationError as exc:
            raise ValueError(f"The saved rules are not valid: {_first_error(exc)}") from None

        if not parsed.entry_conditions:
            raise ValueError(
                "Add at least one entry condition in the builder; "
                "without one the strategy never trades."
            )
        for condition in parsed.entry_conditions + parsed.exit_conditions:
            for operand in (condition.left, condition.right):
                if operand.type == "value" and (
                    isinstance(operand.value, bool)
                    or not isinstance(operand.value, (int, float))
                ):
                    raise ValueError(
                        f"Condition values must be numbers; {operand.value!r} is not."
                    )

        self.config = parsed
        self._indicators = {
            indicator.name: (INDICATORS[indicator.type], indicator.parameters)
            for indicator in parsed.indicators
        }
        self._frames: dict[str, pd.DataFrame] | None = None
        self._first_index = None
        self._holding = False

    @property
    def required_columns(self) -> set[str]:
        columns = {"close"}
        for spec, _ in self._indicators.values():
            columns.update(spec.required_columns)
        for condition in self.config.entry_conditions + self.config.exit_conditions:
            for operand in (condition.left, condition.right):
                if operand.type == "price":
                    columns.add(operand.field)
        return columns

    def _compute(self, data: pd.DataFrame) -> dict[str, pd.DataFrame]:
        return {
            name: compute_indicator(spec, parameters, data)
            for name, (spec, parameters) in self._indicators.items()
        }

    def prepare(self, data: pd.DataFrame) -> None:
        """Called by the engine once, with the run's data, before the first bar."""
        self._check_columns(data)
        self._frames = self._compute(data)
        self._first_index = data.index[0] if len(data) else None
        self._holding = False

    def _check_columns(self, data: pd.DataFrame) -> None:
        missing = sorted(self.required_columns - set(data.columns))
        if missing:
            raise ValueError(
                "The rules need price columns that the data does not have: "
                + ", ".join(missing)
            )

    def _frames_for(self, data: pd.DataFrame) -> dict[str, pd.DataFrame]:
        timestamp = data.index[-1]
        prepared = (
            self._frames is not None
            and self._first_index == data.index[0]
            and all(timestamp in frame.index for frame in self._frames.values())
        )
        return self._frames if prepared else self._compute(data)

    @staticmethod
    def _value(operand, data: pd.DataFrame, frames, timestamp) -> float:
        if operand.type == "value":
            return float(operand.value)
        if operand.type == "price":
            return float(data[operand.field].iloc[-1])
        value = frames[operand.name].at[timestamp, operand.output]
        return float(value) if value is not None else math.nan

    def holds(self, conditions, data: pd.DataFrame, frames=None) -> bool:
        """True when every condition holds at the last bar of `data`."""
        frames = frames if frames is not None else self._frames_for(data)
        timestamp = data.index[-1]
        for condition in conditions:
            left = self._value(condition.left, data, frames, timestamp)
            right = self._value(condition.right, data, frames, timestamp)
            if math.isnan(left) or math.isnan(right):
                return False
            if not OPERATORS[condition.operator](left, right):
                return False
        return True

    def generate_signal(self, context: StrategyContext) -> StrategySignal:
        data = context.market_data.get("data")
        if not isinstance(data, pd.DataFrame):
            raise ValueError("context.market_data['data'] must be a pandas DataFrame.")
        self._check_columns(data)

        # The engine says what is held; without it the strategy follows its own signals.
        position = context.market_data.get("position_quantity")
        holding = self._holding if position is None else position != 0

        frames = self._frames_for(data)
        if holding:
            exit_now = bool(self.config.exit_conditions) and self.holds(
                self.config.exit_conditions, data, frames
            )
            action = SignalAction.EXIT if exit_now else SignalAction.HOLD
            self._holding = not exit_now
        else:
            enter_now = self.holds(self.config.entry_conditions, data, frames)
            action = SignalAction.BUY if enter_now else SignalAction.HOLD
            self._holding = enter_now

        return StrategySignal(action=action, timestamp=context.timestamp)
