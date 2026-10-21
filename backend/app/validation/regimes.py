"""Rule-based market regimes for regime stress testing (Phase 11).

Each day is labelled from the instrument's closes:
- trend: bull when the close is at or above its trend_window-day simple moving
  average, bear when below;
- volatility: high when the volatility_window-day volatility of daily returns
  (annualised, 252 days) is above the median of that volatility over the run,
  low otherwise.

The four regimes are bull/bear x low/high volatility, as in the synopsis. Days
before both averages exist are warm-up and get no regime. The labels are only
used to split a finished backtest's daily returns after the fact; the strategy
never sees them.
"""

from __future__ import annotations

import math

import pandas as pd

TRADING_DAYS = 252
WARM_UP = "warm_up"

REGIMES = {
    "bull_low_volatility": "Bull, low volatility",
    "bull_high_volatility": "Bull, high volatility",
    "bear_low_volatility": "Bear, low volatility",
    "bear_high_volatility": "Bear, high volatility",
}

METHOD = (
    "Bull when the close is at or above its {trend}-day average, bear below it; "
    "high volatility when the {vol}-day volatility of daily returns is above its "
    "median over the run ({threshold:.1%} a year), low otherwise."
)


def label_regimes(
    close: pd.Series,
    *,
    trend_window: int = 200,
    volatility_window: int = 20,
) -> tuple[pd.Series, dict]:
    """A regime key for every day (None during warm-up), and how they were made."""
    if not isinstance(close, pd.Series) or close.empty:
        raise ValueError("close must be a non-empty pandas Series.")
    for name, window in (("trend_window", trend_window), ("volatility_window", volatility_window)):
        if isinstance(window, bool) or not isinstance(window, int) or window < 2:
            raise ValueError(f"{name} must be an integer of at least 2.")

    close = close.astype(float)
    average = close.rolling(trend_window).mean()
    volatility = close.pct_change().rolling(volatility_window).std() * math.sqrt(TRADING_DAYS)
    ready = average.notna() & volatility.notna()
    if not ready.any():
        raise ValueError(
            f"Not enough data to label regimes: needs more than {trend_window} daily bars."
        )

    threshold = float(volatility[ready].median())
    labels = pd.Series([None] * len(close), index=close.index, dtype=object)
    for timestamp in close.index[ready]:
        trend = "bull" if close[timestamp] >= average[timestamp] else "bear"
        level = "high" if volatility[timestamp] > threshold else "low"
        labels[timestamp] = f"{trend}_{level}_volatility"

    return labels, {
        "method": METHOD.format(trend=trend_window, vol=volatility_window, threshold=threshold),
        "trend_window": trend_window,
        "volatility_window": volatility_window,
        "volatility_threshold": threshold,
        "warm_up_bars": int((~ready).sum()),
    }


def regime_periods(labels: pd.Series) -> list[dict]:
    """Consecutive days with the same regime, as periods (for shading a chart)."""
    periods: list[dict] = []
    for timestamp, label in labels.items():
        key = label or WARM_UP
        stamp = pd.Timestamp(timestamp).isoformat()
        if periods and periods[-1]["regime"] == key:
            periods[-1]["end"] = stamp
            periods[-1]["bars"] += 1
        else:
            periods.append({"regime": key, "start": stamp, "end": stamp, "bars": 1})
    return periods
