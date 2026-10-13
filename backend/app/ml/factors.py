from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

import numpy as np
import pandas as pd

from app.ml.scoring import normalize_factor
from app.quant.indicators.sma import SMA
from app.quant.statistics.returns import calculate_returns
from app.quant.statistics.rolling_std import rolling_std
from app.quant.statistics.z_score import rolling_z_score


DEFAULT_FACTOR_WINDOWS = {
    "trend": 20,
    "momentum": 20,
    "volatility_short": 5,
    "volatility_long": 20,
    "stability": 20,
}

DEFAULT_DIRECTIONAL_BOUNDS = {
    "trend_strength": (-3.0, 3.0),
    "relative_momentum": (-0.20, 0.20),
    "price_deviation": (-3.0, 3.0),
    "spread_deviation": (-3.0, 3.0),
    "volatility_relationship": (-1.0, 1.0),
}


def _validate_window(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 2:
        raise ValueError(f"{name} must be an integer >= 2.")


def _prepare_data(
    data: pd.DataFrame,
    required_columns: tuple[str, ...],
    as_of: Any | None,
) -> pd.DataFrame:
    if not isinstance(data, pd.DataFrame) or data.empty:
        raise ValueError("data must be a non-empty pandas DataFrame.")
    if not data.index.is_unique or not data.index.is_monotonic_increasing:
        raise ValueError("data index must be unique and chronological.")

    missing = set(required_columns) - set(data.columns)
    if missing:
        raise ValueError(f"Missing required market-data columns: {sorted(missing)}.")

    if as_of is not None:
        try:
            data = data.loc[data.index <= as_of]
        except (TypeError, ValueError) as exc:
            raise ValueError("as_of must be comparable with the data index.") from exc
        if data.empty:
            raise ValueError("No market data is available at or before as_of.")

    result = data.loc[:, list(required_columns)].copy()
    for column in required_columns:
        result[column] = pd.to_numeric(result[column], errors="coerce")
        values = result[column].to_numpy(dtype=float)
        if not np.isfinite(values).all():
            raise ValueError(f"{column} values must be finite numeric values.")
        if (values <= 0).any():
            raise ValueError(f"{column} values must be greater than zero.")
    return result


def _require_history(data: pd.DataFrame | pd.Series, required: int) -> None:
    if len(data) < required:
        raise ValueError(
            f"Insufficient history: need at least {required} observations; "
            f"received {len(data)}."
        )


def _last_finite(series: pd.Series, name: str) -> float:
    if series.empty or pd.isna(series.iloc[-1]):
        raise ValueError(f"Insufficient valid history to calculate {name}.")
    value = float(series.iloc[-1])
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite.")
    return value


def _directional(
    value: float,
    factor: str,
    bounds: Mapping[str, tuple[float, float]],
) -> float:
    raw_min, raw_max = bounds[factor]
    return normalize_factor(
        value,
        raw_min=raw_min,
        raw_max=raw_max,
        target_min=-1.0,
        target_max=1.0,
    )


def _suitability(value: float) -> float:
    return normalize_factor(value, raw_min=0.0, raw_max=1.0)


def _volatility_suitability(returns: pd.Series, window: int) -> float:
    """Heuristic: map sample volatility in [0, 0.05] to suitability [1, 0]."""
    _require_history(returns, window)
    volatility = float(returns.tail(window).std(ddof=1))
    if not math.isfinite(volatility):
        raise ValueError("Insufficient history for volatility suitability.")
    raw = 1.0 - min(max(volatility / 0.05, 0.0), 1.0)
    return _suitability(raw)


def _volatility_stability(returns: pd.Series, window: int) -> float:
    """Heuristic: one minus the clipped CV of trailing rolling volatility."""
    rolling_vol = returns.rolling(window=window, min_periods=window).std(ddof=1)
    valid = rolling_vol.dropna().tail(window)
    _require_history(valid, window)
    mean_vol = float(valid.mean())
    if not math.isfinite(mean_vol) or mean_vol <= 0:
        raise ValueError("Volatility stability requires positive mean volatility.")
    cv = float(valid.std(ddof=1) / mean_vol)
    if not math.isfinite(cv):
        raise ValueError("Volatility stability must be finite.")
    return _suitability(1.0 - min(max(cv, 0.0), 1.0))


def _spread_stability(spread: pd.Series, window: int) -> float:
    """Heuristic: one minus the clipped CV of trailing absolute spread changes."""
    changes = spread.diff().abs().dropna().tail(window)
    _require_history(changes, window)
    mean_change = float(changes.mean())
    if not math.isfinite(mean_change):
        raise ValueError("Mean absolute spread change must be finite.")
    if mean_change == 0:
        return 1.0
    cv = float(changes.std(ddof=1) / mean_change)
    if not math.isfinite(cv):
        raise ValueError("Spread stability must be finite.")
    return _suitability(1.0 - min(max(cv, 0.0), 1.0))


def _trend_strength(returns: pd.Series, window: int) -> float:
    recent = returns.dropna().tail(window)
    _require_history(recent, window)
    std = float(recent.std(ddof=1))
    mean = float(recent.mean())
    if not math.isfinite(std) or std <= 0:
        raise ValueError("Trend strength requires positive return volatility.")
    return mean / std


def calculate_strategy_factors(
    strategy: str,
    data: pd.DataFrame,
    *,
    windows: Mapping[str, int] | None = None,
    normalization_bounds: Mapping[str, tuple[float, float]] | None = None,
    as_of: Any | None = None,
) -> dict[str, float]:
    """Calculate normalized factors from trailing data available at ``as_of``.

    Suitability/stability formulas and all default bounds are engineering
    heuristics, not empirically validated trading thresholds. Input data must
    contain only the market observations relevant to the requested instruments.
    """
    if strategy not in {
        "momentum",
        "mean_reversion",
        "statistical_arbitrage",
        "tactical_asset_allocation",
        "volatility_arbitrage",
    }:
        raise ValueError(f"Unknown strategy: {strategy!r}.")

    bounds = dict(DEFAULT_DIRECTIONAL_BOUNDS)
    if normalization_bounds is not None:
        if not isinstance(normalization_bounds, Mapping):
            raise ValueError("normalization_bounds must be a mapping.")
        unknown_bounds = set(normalization_bounds) - set(bounds)
        if unknown_bounds:
            raise ValueError(
                f"Unknown normalization bounds: {sorted(unknown_bounds)}."
            )
        for name, pair in normalization_bounds.items():
            if not isinstance(pair, (tuple, list)) or len(pair) != 2:
                raise ValueError(
                    f"Bounds for {name} must contain (raw_min, raw_max)."
                )
            low, high = pair
            if (
                isinstance(low, bool)
                or isinstance(high, bool)
                or not isinstance(low, (int, float))
                or not isinstance(high, (int, float))
                or not math.isfinite(low)
                or not math.isfinite(high)
                or low >= high
            ):
                raise ValueError(
                    f"Bounds for {name} must be finite numbers with raw_min < raw_max."
                )
            bounds[name] = (float(low), float(high))

    config = dict(DEFAULT_FACTOR_WINDOWS)
    if windows is not None:
        if not isinstance(windows, Mapping):
            raise ValueError("windows must be a mapping.")
        unknown = set(windows) - set(config)
        if unknown:
            raise ValueError(f"Unknown factor windows: {sorted(unknown)}.")
        config.update(windows)

    for name, value in config.items():
        _validate_window(name, value)
    if config["volatility_short"] >= config["volatility_long"]:
        raise ValueError("volatility_short must be less than volatility_long.")

    if strategy == "statistical_arbitrage":
        market = _prepare_data(data, ("instrument_a", "instrument_b"), as_of)
        window = config["trend"]
        _require_history(
            market,
            max(window, config["stability"] + 1, config["volatility_long"] + 1),
        )
        spread = market["instrument_a"] - market["instrument_b"]
        z = _last_finite(
            rolling_z_score(spread.to_frame("spread"), "spread", window),
            "spread deviation",
        )

        returns_a = market["instrument_a"].pct_change().dropna()
        returns_b = market["instrument_b"].pct_change().dropna()
        _require_history(returns_a, config["volatility_long"])
        _require_history(returns_b, config["volatility_long"])
        vol_a = float(returns_a.tail(config["volatility_long"]).std(ddof=1))
        vol_b = float(returns_b.tail(config["volatility_long"]).std(ddof=1))
        pair_volatility = (vol_a + vol_b) / 2.0
        if not math.isfinite(pair_volatility):
            raise ValueError("Pair volatility must be finite.")
        vol_suitability = _suitability(
            1.0 - min(max(pair_volatility / 0.05, 0.0), 1.0)
        )
        return {
            "spread_deviation": _directional(z, "spread_deviation", bounds),
            "spread_stability": _spread_stability(spread, config["stability"]),
            "volatility_suitability": vol_suitability,
        }

    market = _prepare_data(data, ("close",), as_of)
    close = market["close"]
    returns = close.pct_change().dropna()

    if strategy == "tactical_asset_allocation":
        window = config["momentum"]
        _require_history(
            close,
            max(window + 1, config["volatility_long"] + 1),
        )
        relative = float(close.iloc[-1] / close.iloc[-1 - window] - 1.0)
        return {
            "relative_momentum": _directional(
                relative, "relative_momentum", bounds
            ),
            "volatility_suitability": _volatility_suitability(
                returns, config["volatility_long"]
            ),
        }

    if strategy == "momentum":
        window = config["trend"]
        _require_history(
            market,
            max(window + 1, config["volatility_long"] + 1),
        )
        sma_value = _last_finite(SMA(window).calculate(market), "SMA")
        relative = float(close.iloc[-1] / sma_value - 1.0)
        strength = _trend_strength(returns, window)
        return {
            "trend_strength": _directional(strength, "trend_strength", bounds),
            "relative_momentum": _directional(
                relative, "relative_momentum", bounds
            ),
            "volatility_suitability": _volatility_suitability(
                returns, config["volatility_long"]
            ),
        }

    if strategy == "mean_reversion":
        window = config["trend"]
        _require_history(
            market,
            max(window + 1, config["volatility_long"] + 1),
        )
        z = _last_finite(
            rolling_z_score(market, "close", window),
            "price deviation",
        )
        strength = _trend_strength(returns, window)
        trend_fit = _suitability(1.0 - min(abs(strength) / 3.0, 1.0))
        return {
            "price_deviation": _directional(z, "price_deviation", bounds),
            "trend_suitability": trend_fit,
            "volatility_suitability": _volatility_suitability(
                returns, config["volatility_long"]
            ),
        }

    if strategy == "volatility_arbitrage":
        long_window = config["volatility_long"]
        _require_history(
            close,
            max(long_window + 1, 2 * config["stability"]),
        )
        returns_frame = returns.to_frame("returns")
        short_vol = _last_finite(
            rolling_std(returns_frame, "returns", config["volatility_short"]),
            "short realized volatility",
        )
        long_vol = _last_finite(
            rolling_std(returns_frame, "returns", long_window),
            "long realized volatility",
        )
        if long_vol <= 0:
            raise ValueError("Long-window volatility must be positive.")
        relationship = short_vol / long_vol - 1.0
        return {
            "volatility_relationship": _directional(
                relationship, "volatility_relationship", bounds
            ),
            "volatility_stability": _volatility_stability(
                returns, config["stability"]
            ),
        }

    raise ValueError(f"Unknown strategy: {strategy!r}.")
