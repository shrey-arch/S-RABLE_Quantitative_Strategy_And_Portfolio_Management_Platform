"""Bars for live paper trading (Feature 7): 1-minute bars into 1, 5 or 15-minute
bars aligned to 09:15, handing over only closed bars; a partial bar is reported
as "forming" for the chart only. Nothing is ever invented: a missing minute is
simply missing (the session's stale guard decides what to do)."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pandas as pd

from app.live.clock import IST, session_close, session_open

TIMEFRAMES = {"1M": 1, "5M": 5, "15M": 15}
COLUMNS = ["open", "high", "low", "close", "volume"]


def frame(rows) -> pd.DataFrame:
    """1-minute bars (dicts or objects with timestamp/open/high/low/close/volume)
    as a DataFrame indexed by bar start (UTC), sorted, without duplicates."""
    records = []
    for row in rows:
        get = row.get if isinstance(row, dict) else lambda k, r=row: getattr(r, k)
        records.append(
            {
                "timestamp": pd.Timestamp(get("timestamp")).tz_convert("UTC")
                if pd.Timestamp(get("timestamp")).tzinfo
                else pd.Timestamp(get("timestamp")).tz_localize("UTC"),
                "open": float(get("open")),
                "high": float(get("high")),
                "low": float(get("low")),
                "close": float(get("close")),
                "volume": float(get("volume") or 0),
            }
        )
    if not records:
        return pd.DataFrame(columns=COLUMNS, index=pd.DatetimeIndex([], tz="UTC", name="timestamp"))
    df = pd.DataFrame.from_records(records).set_index("timestamp").sort_index()
    return df[~df.index.duplicated(keep="first")][COLUMNS]


def bucket_start(at: datetime, timeframe: str) -> datetime:
    """The start of the timeframe bucket (aligned to 09:15 IST) holding `at`."""
    minutes = TIMEFRAMES[timeframe]
    local = at.astimezone(IST)
    opened = session_open(local.date())
    index = int((local - opened).total_seconds() // 60) // minutes
    return opened + timedelta(minutes=index * minutes)


def aggregate(one_minute: pd.DataFrame, timeframe: str, day: date, market_time: datetime) -> tuple[pd.DataFrame, dict | None]:
    """The day's closed bars of `timeframe` by market time, and the forming one.

    A bucket is closed once market time reaches its end (start + timeframe, or
    15:30 for the last one). Bars outside the session are ignored."""
    minutes = TIMEFRAMES[timeframe]
    start, close = session_open(day), session_close(day)
    if one_minute.empty:
        return frame([]), None
    local = one_minute.index.tz_convert(IST)
    # Only complete 1-minute bars (a bar starting at m is complete at m + 1 min).
    done = local + pd.Timedelta(minutes=1) <= market_time
    day_bars = one_minute[(local >= start) & (local < close) & done]
    closed_rows, forming = [], None
    if day_bars.empty:
        return frame([]), None
    # A Series of keys (a one-item list would be read as a list of groupers).
    keys = pd.Series([bucket_start(t.to_pydatetime(), timeframe) for t in day_bars.index], index=day_bars.index)
    for key, group in day_bars.groupby(keys, sort=True):
        end = min(key + timedelta(minutes=minutes), close)
        bar = {
            "timestamp": pd.Timestamp(key).tz_convert("UTC"),
            "open": float(group["open"].iloc[0]),
            "high": float(group["high"].max()),
            "low": float(group["low"].min()),
            "close": float(group["close"].iloc[-1]),
            "volume": float(group["volume"].sum()),
        }
        if market_time >= end:
            closed_rows.append(bar)
        else:
            forming = {**bar, "minutes": len(group), "of": minutes}
    return frame(closed_rows), forming


def bar_end(start: datetime, timeframe: str) -> datetime:
    day = start.astimezone(IST).date()
    return min(start + timedelta(minutes=TIMEFRAMES[timeframe]), session_close(day))


def history(one_minute: pd.DataFrame, timeframe: str, market_time: datetime) -> tuple[pd.DataFrame, dict | None]:
    """Closed bars of every stored day up to market time (earlier days give the
    strategy its warm-up), and the current day's forming bar."""
    if one_minute.empty:
        return frame([]), None
    days = sorted({t.date() for t in one_minute.index.tz_convert(IST)})
    parts, forming = [], None
    today = market_time.astimezone(IST).date()
    for day in days:
        if day > today:
            break
        closed, partial = aggregate(one_minute, timeframe, day, market_time)
        parts.append(closed)
        if day == today:
            forming = partial
    out = pd.concat([p for p in parts if not p.empty]) if any(not p.empty for p in parts) else frame([])
    return out, forming
