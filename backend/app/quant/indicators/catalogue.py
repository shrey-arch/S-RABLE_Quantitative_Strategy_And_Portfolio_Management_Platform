"""
The indicators a strategy configuration may use, with their parameters.

This is the single source for:
  * GET /indicators (the catalogue shown in the app),
  * validating `strategy_config.indicators` when a strategy is saved, and
  * computing indicator series for charts.

Every entry computes with the classes and functions in app.quant, so a chart shows
exactly what the backend calculates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

import pandas as pd

from app.quant.indicators.atr import ATR
from app.quant.indicators.bollinger import BollingerBands
from app.quant.indicators.ema import EMA
from app.quant.indicators.macd import MACD
from app.quant.indicators.rsi import RSI
from app.quant.indicators.sma import SMA
from app.quant.statistics.returns import calculate_returns
from app.quant.statistics.rolling_std import rolling_std
from app.quant.statistics.z_score import rolling_z_score

Panel = Literal["price", "separate"]


class IndicatorValidationError(ValueError):
    """An indicator type or its parameters are not acceptable."""


@dataclass(frozen=True)
class ParameterSpec:
    name: str
    type: Literal["int", "float"]
    description: str
    default: int | float | None = None
    minimum: float | None = None
    exclusive_minimum: bool = False

    @property
    def required(self) -> bool:
        return self.default is None


@dataclass(frozen=True)
class IndicatorSpec:
    key: str
    name: str
    category: str
    panel: Panel
    definition: str
    outputs: tuple[str, ...]
    parameters: tuple[ParameterSpec, ...]
    required_columns: tuple[str, ...]
    compute: Callable[[pd.DataFrame, dict[str, Any]], pd.DataFrame]
    rules: tuple[str, ...] = ()
    used_by: tuple[str, ...] = field(default_factory=tuple)


def _series(name: str):
    def wrap(fn):
        def compute(data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
            return pd.DataFrame({name: fn(data, params)}, index=data.index)

        return compute

    return wrap


def _frame(fn):
    def compute(data: pd.DataFrame, params: dict[str, Any]) -> pd.DataFrame:
        return fn(data, params)

    return compute


@_series("value")
def _sma(data, p):
    return SMA(p["window"]).calculate(data)


@_series("value")
def _ema(data, p):
    return EMA(p["window"]).calculate(data)


@_series("value")
def _rsi(data, p):
    return RSI(p["period"]).calculate(data)


@_series("value")
def _atr(data, p):
    return ATR(p["period"]).calculate(data)


@_frame
def _macd(data, p):
    return MACD(p["fast_period"], p["slow_period"], p["signal_period"]).calculate(data)


@_frame
def _bollinger(data, p):
    return BollingerBands(p["window"], p["num_std"]).calculate(data)


@_series("value")
def _z_score(data, p):
    return rolling_z_score(data, "close", p["window"])


@_series("value")
def _rolling_volatility(data, p):
    returns = pd.DataFrame({"returns": calculate_returns(data)}, index=data.index)
    return rolling_std(returns, "returns", p["window"])


def _window(description: str, default: int | None = None) -> ParameterSpec:
    return ParameterSpec(
        "window", "int", description, default=default, minimum=0, exclusive_minimum=True
    )


def _period(default: int = 14) -> ParameterSpec:
    return ParameterSpec(
        "period",
        "int",
        "Smoothing period in bars (Wilder's smoothing).",
        default=default,
        minimum=0,
        exclusive_minimum=True,
    )


INDICATORS: dict[str, IndicatorSpec] = {
    spec.key: spec
    for spec in (
        IndicatorSpec(
            key="SMA",
            name="Simple moving average",
            category="Trend",
            panel="price",
            definition="Average of the last N closing prices.",
            outputs=("value",),
            parameters=(_window("Number of bars averaged."),),
            required_columns=("close",),
            compute=_sma,
            used_by=("momentum",),
        ),
        IndicatorSpec(
            key="EMA",
            name="Exponential moving average",
            category="Trend",
            panel="price",
            definition="Moving average of closing prices that weights recent bars more "
            "(span N, smoothing 2 / (N + 1)).",
            outputs=("value",),
            parameters=(_window("Span in bars."),),
            required_columns=("close",),
            compute=_ema,
        ),
        IndicatorSpec(
            key="RSI",
            name="Relative strength index",
            category="Momentum",
            panel="separate",
            definition="Ratio of average gains to average losses over N bars, scaled "
            "0 to 100.",
            outputs=("value",),
            parameters=(_period(),),
            required_columns=("close",),
            compute=_rsi,
        ),
        IndicatorSpec(
            key="ATR",
            name="Average true range",
            category="Volatility",
            panel="separate",
            definition="Average of the true range (largest of high-low, |high-previous "
            "close|, |low-previous close|) over N bars.",
            outputs=("value",),
            parameters=(_period(),),
            required_columns=("high", "low", "close"),
            compute=_atr,
        ),
        IndicatorSpec(
            key="MACD",
            name="Moving average convergence divergence",
            category="Momentum",
            panel="separate",
            definition="Fast EMA minus slow EMA (macd), its EMA (signal), and their "
            "difference (histogram).",
            outputs=("macd", "signal", "histogram"),
            parameters=(
                ParameterSpec("fast_period", "int", "Fast EMA span.", 12, 0, True),
                ParameterSpec("slow_period", "int", "Slow EMA span.", 26, 0, True),
                ParameterSpec("signal_period", "int", "Signal line EMA span.", 9, 0, True),
            ),
            required_columns=("close",),
            compute=_macd,
            rules=("fast_period must be less than slow_period.",),
        ),
        IndicatorSpec(
            key="BOLLINGER",
            name="Bollinger bands",
            category="Volatility",
            panel="price",
            definition="SMA of N closes (middle) with bands num_std sample standard "
            "deviations above (upper) and below (lower).",
            outputs=("middle", "upper", "lower"),
            parameters=(
                _window("Number of bars.", 20),
                ParameterSpec(
                    "num_std", "float", "Band width in standard deviations.", 2.0, 0, False
                ),
            ),
            required_columns=("close",),
            compute=_bollinger,
        ),
        IndicatorSpec(
            key="ZSCORE",
            name="Rolling z-score",
            category="Statistics",
            panel="separate",
            definition="How many rolling standard deviations the close is from its "
            "rolling mean over N bars.",
            outputs=("value",),
            parameters=(_window("Number of bars."),),
            required_columns=("close",),
            compute=_z_score,
            used_by=("mean_reversion",),
        ),
        IndicatorSpec(
            key="ROLLING_VOLATILITY",
            name="Rolling volatility",
            category="Statistics",
            panel="separate",
            definition="Sample standard deviation of daily close-to-close returns over "
            "N bars (not annualised).",
            outputs=("value",),
            parameters=(_window("Number of bars."),),
            required_columns=("close",),
            compute=_rolling_volatility,
            used_by=("volatility_arbitrage",),
        ),
    )
}


def get_indicator(key: str) -> IndicatorSpec:
    spec = INDICATORS.get(key.strip().upper()) if isinstance(key, str) else None
    if spec is None:
        raise IndicatorValidationError(
            f"Unknown indicator type '{key}'. Use one of: {', '.join(INDICATORS)}."
        )
    return spec


def _number(spec: ParameterSpec, value: Any) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise IndicatorValidationError(f"{spec.name} must be a number.")
    if spec.type == "int":
        if isinstance(value, float) and not value.is_integer():
            raise IndicatorValidationError(f"{spec.name} must be a whole number.")
        value = int(value)
    else:
        value = float(value)
    if spec.minimum is not None:
        if spec.exclusive_minimum and value <= spec.minimum:
            raise IndicatorValidationError(f"{spec.name} must be greater than {spec.minimum:g}.")
        if not spec.exclusive_minimum and value < spec.minimum:
            raise IndicatorValidationError(f"{spec.name} must be at least {spec.minimum:g}.")
    return value


def validate_indicator(key: str, parameters: dict[str, Any]) -> tuple[IndicatorSpec, dict]:
    """
    Checks a type and its parameters and returns the spec and the complete
    parameters (defaults filled in). Raises IndicatorValidationError.
    """
    spec = get_indicator(key)
    known = {p.name for p in spec.parameters}
    unknown = sorted(set(parameters) - known)
    if unknown:
        raise IndicatorValidationError(
            f"{spec.key} does not take {', '.join(unknown)}. "
            f"Its parameters are: {', '.join(p.name for p in spec.parameters)}."
        )

    values: dict[str, Any] = {}
    for p in spec.parameters:
        if p.name in parameters and parameters[p.name] is not None:
            values[p.name] = _number(p, parameters[p.name])
        elif p.required:
            raise IndicatorValidationError(f"{spec.key} needs {p.name}.")
        else:
            values[p.name] = p.default

    # The classes enforce their own rules (e.g. MACD fast < slow).
    try:
        spec.compute(pd.DataFrame({c: [1.0, 1.0] for c in ("open", "high", "low", "close")}), values)
    except ValueError as exc:
        raise IndicatorValidationError(str(exc)) from exc
    return spec, values


def compute_indicator(spec: IndicatorSpec, values: dict[str, Any], data: pd.DataFrame) -> pd.DataFrame:
    """Columns are the spec's outputs, indexed like `data`."""
    frame = spec.compute(data, values)
    return frame[list(spec.outputs)]
