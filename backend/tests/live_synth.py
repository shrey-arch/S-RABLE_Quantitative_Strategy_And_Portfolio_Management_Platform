"""Synthetic intraday 1-minute bars for live paper trading tests (Feature 7):
whole NSE sessions (09:15-15:30 IST), trending stretches that switch direction,
so momentum and mean-reversion strategies both trade."""

from datetime import date

import numpy as np
import pandas as pd

from app.live.clock import session_minutes


def intraday_day(day: date, seed: int = 1, start: float = 1000.0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    minutes = session_minutes(day)
    n = len(minutes)
    drift = np.empty(n)
    i, sign = 0, 1
    while i < n:
        length = int(rng.integers(25, 70))
        drift[i : i + length] = sign * 0.0006
        sign = -sign
        i += length
    returns = drift + rng.normal(0, 0.0012, n)
    close = start * np.exp(np.cumsum(returns))
    open_ = np.r_[start, close[:-1]]
    spread = np.abs(rng.normal(0, 0.0008, n)) * close
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    index = pd.DatetimeIndex([m.astimezone(tz=None) for m in minutes]).tz_convert("UTC")
    index.name = "timestamp"
    return pd.DataFrame(
        {
            "open": open_.round(2),
            "high": high.round(2),
            "low": low.round(2),
            "close": close.round(2),
            "volume": rng.integers(1000, 9000, n),
        },
        index=index,
    )


def intraday_days(days: list[date], seed: int = 1, start: float = 1000.0) -> pd.DataFrame:
    parts, price = [], start
    for k, day in enumerate(days):
        df = intraday_day(day, seed + k, price)
        parts.append(df)
        price = float(df["close"].iloc[-1])
    return pd.concat(parts)
