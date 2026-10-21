"""Market quotes for paper trading.

Source: Yahoo Finance (NSE symbols as SYMBOL.NS), which may lag the exchange
by up to about 15 minutes. Each quote carries its own time; every screen
shows it. Quotes are cached for 60 seconds per symbol so pages and the order
matcher do not call Yahoo more than once a minute.

Tests replace the provider with `set_quote_provider`."""

import logging
import threading
import time as _time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Protocol

from app.enums import Exchange, InstrumentType
from app.services.paper import clock
from app.services.paper.clock import session_close

logger = logging.getLogger(__name__)

SOURCE = "Yahoo Finance"
DELAY_NOTE = "Prices from Yahoo Finance may be delayed by up to about 15 minutes."
CACHE_SECONDS = 60


@dataclass(frozen=True)
class Quote:
    symbol: str
    price: float
    time: datetime  # UTC time of the price
    previous_close: float | None = None
    source: str = SOURCE
    delayed: bool = True
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class QuoteUnavailable(Exception):
    pass


class QuoteProvider(Protocol):
    def fetch(self, yahoo_symbol: str) -> Quote: ...


def yahoo_symbol(instrument) -> str:
    if instrument.exchange is not Exchange.NSE or instrument.instrument_type not in (
        InstrumentType.EQUITY,
        InstrumentType.ETF,
    ):
        raise QuoteUnavailable("Paper trading supports NSE equities and ETFs only.")
    return f"{instrument.symbol}.NS"


class YahooQuoteProvider:
    """Latest 1-minute bar of today, else the latest daily close."""

    def fetch(self, yahoo_symbol: str) -> Quote:
        import yfinance as yf

        try:
            ticker = yf.Ticker(yahoo_symbol)
            daily = ticker.history(period="5d", interval="1d", auto_adjust=False)
            intraday = ticker.history(period="1d", interval="1m", auto_adjust=False)
        except Exception as exc:  # network, rate limit, parsing
            raise QuoteUnavailable(f"Yahoo Finance did not answer for {yahoo_symbol}.") from exc
        if daily is None or daily.empty:
            raise QuoteUnavailable(f"No price from Yahoo Finance for {yahoo_symbol}.")
        closes = [float(c) for c in daily["Close"].tolist()]
        last_day = daily.index[-1].date()
        if intraday is not None and not intraday.empty:
            stamp = intraday.index[-1]
            price = float(intraday["Close"].iloc[-1])
            moment = stamp.to_pydatetime().astimezone(timezone.utc)
            previous = closes[-2] if len(closes) > 1 and last_day == stamp.date() else closes[-1]
        else:
            price = closes[-1]
            moment = session_close(last_day).astimezone(timezone.utc)
            previous = closes[-2] if len(closes) > 1 else None
        return Quote(symbol=yahoo_symbol, price=round(price, 4), time=moment, previous_close=previous)


_provider: QuoteProvider = YahooQuoteProvider()
_cache: dict[str, tuple[float, Quote]] = {}
_lock = threading.Lock()


def set_quote_provider(provider: QuoteProvider | None) -> None:
    """Swap the provider (tests); None restores Yahoo. Clears the cache."""
    global _provider
    _provider = provider or YahooQuoteProvider()
    with _lock:
        _cache.clear()


def get_quote(instrument) -> Quote:
    symbol = yahoo_symbol(instrument)
    now = _time.monotonic()
    with _lock:
        cached = _cache.get(symbol)
        if cached and now - cached[0] < CACHE_SECONDS:
            return cached[1]
    quote = _provider.fetch(symbol)
    with _lock:
        _cache[symbol] = (now, quote)
    return quote


def try_quote(instrument) -> tuple[Quote | None, str | None]:
    try:
        return get_quote(instrument), None
    except QuoteUnavailable as exc:
        return None, str(exc)
    except Exception:  # never let a price problem break a page
        logger.exception("Quote failed for %s", getattr(instrument, "symbol", "?"))
        return None, "The price could not be loaded."


def quote_payload(quote: Quote) -> dict:
    change = None
    change_pct = None
    if quote.previous_close:
        change = round(quote.price - quote.previous_close, 4)
        change_pct = round(change / quote.previous_close * 100, 4)
    return {
        "price": quote.price,
        "time": quote.time.isoformat(),
        "previous_close": quote.previous_close,
        "change": change,
        "change_percent": change_pct,
        "source": quote.source,
        "delayed": quote.delayed,
        "age_seconds": max(0, int((clock.now_utc() - quote.time).total_seconds())),
    }
