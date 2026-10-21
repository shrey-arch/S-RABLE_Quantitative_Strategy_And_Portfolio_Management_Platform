"""Pre-compute the indicator series a Python strategy asks for (Feature 6).

The strategy calls context.indicator("SMA", period=20); the guard finds every
such call with fixed values before the run. Here we compute each one once, on
the whole price series, with the catalogue's own causal formulas (the same code
the charts use), and hand the child a plain list per output. The value at bar i
uses only bars up to i, so a strategy can never read the future through an
indicator.

The strategy's friendly parameter names (period / window / n / length / span)
map to the catalogue's parameter for single-window indicators; MACD and
Bollinger use the catalogue's own names.
"""

from __future__ import annotations

import math

import pandas as pd

from app.quant.indicators.catalogue import (
    IndicatorValidationError,
    compute_indicator,
    get_indicator,
    validate_indicator,
)
from app.sandbox.guard import IndicatorUse

# For an indicator with one window/period parameter, any of these names is accepted.
_WINDOW_ALIASES = ("period", "window", "n", "length", "span", "bars")


class IndicatorError(ValueError):
    """An indicator call could not be prepared; the message names the line."""


def _map_params(key: str, params: dict[str, float]) -> dict[str, float]:
    spec = get_indicator(key)
    names = [p.name for p in spec.parameters]
    if len(names) == 1 and names[0] in ("window", "period"):
        extra = [k for k in params if k not in names]
        if len(params) == 1 and extra and extra[0] in _WINDOW_ALIASES:
            return {names[0]: params[extra[0]]}
    return params


def precompute(uses: list[IndicatorUse], data: pd.DataFrame) -> dict[str, dict[str, list]]:
    """{indicator_id: {output: [values...]}}, one value per row of `data`."""
    out: dict[str, dict[str, list]] = {}
    for use in uses:
        params = dict(use.params)
        try:
            spec, values = validate_indicator(use.key, _map_params(use.key, params))
            frame = compute_indicator(spec, values, data)
        except IndicatorValidationError as exc:
            raise IndicatorError(f"Line {use.line}: context.indicator({use.key}): {exc}") from exc
        except Exception as exc:  # noqa: BLE001
            raise IndicatorError(
                f"Line {use.line}: context.indicator({use.key}) could not be computed: {exc}"
            ) from exc
        series = {}
        for output in spec.outputs:
            column = frame[output]
            series[output] = [None if _na(v) else float(v) for v in column.tolist()]
        out[use.id] = series
    return out


def _na(value) -> bool:
    try:
        return value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value)
    except (TypeError, ValueError):
        return False
