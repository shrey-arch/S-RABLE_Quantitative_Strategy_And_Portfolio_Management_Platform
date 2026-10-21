"""Market-data feeds for live paper trading (Feature 7).

A feed returns 1-minute bars. Implementations:
- YahooFeed: Yahoo Finance through yfinance (unofficial; NSE prices may be
  delayed). One batched request for all symbols, at most once per poll
  interval; after an error or HTTP 429 it waits longer and longer (exponential
  backoff) instead of asking again at once.
- RecordedFeed: plays saved 1-minute bars, publishing each bar only once it is
  complete (for tests and the sandbox; no network).
- BrokerFeed: the place for a broker's real-time feed; not configured.

Bars are returned as dicts: timestamp (bar start, UTC), open, high, low, close,
volume. Nothing here writes to the database."""

from __future__ import annotations

import logging
import time as _time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pandas as pd

logger = logging.getLogger(__name__)

POLL_SECONDS = 60
BACKOFF_START = 60
BACKOFF_MAX = 900


class FeedError(Exception):
    def __init__(self, message: str, *, rate_limited: bool = False):
        super().__init__(message)
        self.rate_limited = rate_limited


@dataclass
class FeedHealth:
    """What the feed did last; GET /live/status shows it."""

    source: str
    last_poll_at: datetime | None = None
    last_ok_at: datetime | None = None
    last_error: str | None = None
    consecutive_errors: int = 0
    backoff_until: datetime | None = None
    rate_limited: bool = False
    polls: int = 0
    bars_received: int = 0
    last_latency_ms: int | None = None

    def as_dict(self) -> dict:
        iso = lambda v: v.isoformat() if v else None  # noqa: E731
        return {
            "source": self.source,
            "last_poll_at": iso(self.last_poll_at),
            "last_ok_at": iso(self.last_ok_at),
            "last_error": self.last_error,
            "consecutive_errors": self.consecutive_errors,
            "backoff_until": iso(self.backoff_until),
            "rate_limited": self.rate_limited,
            "polls": self.polls,
            "bars_received": self.bars_received,
            "last_latency_ms": self.last_latency_ms,
        }


class LiveFeed:
    """Base: polling with backoff; subclasses implement _fetch."""

    source = "base"

    def __init__(self, now: Callable[[], datetime] | None = None):
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.health = FeedHealth(source=self.source)

    def ready(self) -> bool:
        until = self.health.backoff_until
        return until is None or self.now() >= until

    def fetch_1m(self, symbols: list[str], since: datetime) -> dict[str, list[dict]]:
        """1-minute bars per symbol from `since` (UTC). Raises FeedError; while
        backing off it raises without asking the source."""
        if not self.ready():
            raise FeedError(
                f"Waiting until {self.health.backoff_until:%H:%M:%S} UTC after earlier errors.",
                rate_limited=self.health.rate_limited,
            )
        started = _time.monotonic()
        self.health.last_poll_at = self.now()
        self.health.polls += 1
        try:
            bars = self._fetch(symbols, since)
        except FeedError as exc:
            self._failed(str(exc), exc.rate_limited)
            raise
        except Exception as exc:  # network, parsing
            message = str(exc) or type(exc).__name__
            limited = "429" in message or "Too Many Requests" in message or "Rate limit" in message
            self._failed(message, limited)
            raise FeedError(message, rate_limited=limited) from exc
        self.health.last_latency_ms = int((_time.monotonic() - started) * 1000)
        self.health.last_ok_at = self.now()
        self.health.last_error = None
        self.health.consecutive_errors = 0
        self.health.backoff_until = None
        self.health.rate_limited = False
        count = sum(len(v) for v in bars.values())
        self.health.bars_received += count
        logger.info("live feed %s: %d symbols, %d bars, %d ms", self.source, len(symbols), count, self.health.last_latency_ms)
        return bars

    def _failed(self, message: str, rate_limited: bool) -> None:
        self.health.consecutive_errors += 1
        self.health.last_error = message[:300]
        self.health.rate_limited = rate_limited
        wait = min(BACKOFF_START * 2 ** (self.health.consecutive_errors - 1), BACKOFF_MAX)
        self.health.backoff_until = self.now() + timedelta(seconds=wait)
        logger.warning("live feed %s failed (%s); next try in %ds", self.source, message[:200], wait)

    def _fetch(self, symbols: list[str], since: datetime) -> dict[str, list[dict]]:  # pragma: no cover
        raise NotImplementedError


def _records(df: pd.DataFrame, since: datetime) -> list[dict]:
    out = []
    if df is None or df.empty:
        return out
    index = df.index if df.index.tz is not None else df.index.tz_localize("UTC")
    for stamp, row in zip(index.tz_convert("UTC"), df.itertuples(index=False)):
        if stamp.to_pydatetime() < since:
            continue
        values = row._asdict()
        if any(pd.isna(values.get(k)) for k in ("Open", "High", "Low", "Close")):
            continue
        out.append(
            {
                "timestamp": stamp.to_pydatetime(),
                "open": float(values["Open"]),
                "high": float(values["High"]),
                "low": float(values["Low"]),
                "close": float(values["Close"]),
                "volume": int(values.get("Volume") or 0),
            }
        )
    return out


class YahooFeed(LiveFeed):
    source = "yahoo"

    def _fetch(self, symbols: list[str], since: datetime) -> dict[str, list[dict]]:
        import yfinance as yf

        # Yahoo serves 1-minute bars for about the last 30 days, 7 days per request.
        start = max(since, self.now() - timedelta(days=7))
        data = yf.download(
            tickers=symbols,
            start=start,
            interval="1m",
            group_by="ticker",
            auto_adjust=False,
            progress=False,
            threads=False,
        )
        if data is None:
            raise FeedError("Yahoo Finance returned nothing.")
        out: dict[str, list[dict]] = {}
        for symbol in symbols:
            if isinstance(data.columns, pd.MultiIndex):
                if symbol not in data.columns.get_level_values(0):
                    out[symbol] = []
                    continue
                part = data[symbol]
            else:
                part = data
            out[symbol] = _records(part.dropna(how="all"), since)
        return out


class RecordedFeed(LiveFeed):
    """Saved 1-minute bars (symbol -> DataFrame with open/high/low/close/volume,
    indexed by bar start). A bar is published once it is complete at the feed's
    current time, like a live source; `fail` can make the next polls fail."""

    source = "recorded"

    def __init__(self, bars: dict[str, pd.DataFrame], now: Callable[[], datetime] | None = None):
        super().__init__(now)
        self.bars = bars
        self.fail: list[FeedError] = []

    def _fetch(self, symbols: list[str], since: datetime) -> dict[str, list[dict]]:
        if self.fail:
            raise self.fail.pop(0)
        now = self.now()
        out = {}
        for symbol in symbols:
            df = self.bars.get(symbol)
            rows = []
            if df is not None:
                for stamp, row in df.iterrows():
                    start = pd.Timestamp(stamp).tz_convert("UTC").to_pydatetime()
                    if start < since or start + timedelta(minutes=1) > now:
                        continue
                    rows.append(
                        {
                            "timestamp": start,
                            "open": float(row["open"]),
                            "high": float(row["high"]),
                            "low": float(row["low"]),
                            "close": float(row["close"]),
                            "volume": int(row.get("volume", 0) or 0),
                        }
                    )
            out[symbol] = rows
        return out


class BrokerFeed(LiveFeed):
    """A broker's real-time feed plugs in here (Angel One, Upstox, Zerodha, Dhan)."""

    source = "broker"

    def _fetch(self, symbols: list[str], since: datetime) -> dict[str, list[dict]]:
        raise FeedError("No broker market-data feed is configured.")
