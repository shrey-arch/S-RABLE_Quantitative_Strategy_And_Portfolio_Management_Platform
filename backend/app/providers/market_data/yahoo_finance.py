from datetime import datetime
from uuid import UUID

import pandas as pd
import yfinance as yf

from app.enums import Exchange, InstrumentType
from app.models import Instrument
from app.providers.market_data.base import MarketDataProvider
from app.providers.market_data.schemas import MarketDataPoint
from app.services.instruments.instrument_service import InstrumentService


# NSE indices on Yahoo Finance (Step 0 of the 7-feature roadmap: Nifty 50 and
# India VIX for the regime models). An index named with its Yahoo symbol
# (starting with ^) is used as it is.
INDEX_SYMBOLS = {
    "NIFTY50": "^NSEI",
    "NIFTY 50": "^NSEI",
    "NIFTY": "^NSEI",
    "NSEI": "^NSEI",
    "INDIAVIX": "^INDIAVIX",
    "INDIA VIX": "^INDIAVIX",
    "BANKNIFTY": "^NSEBANK",
    "NIFTYBANK": "^NSEBANK",
    "NIFTY BANK": "^NSEBANK",
}

UNSUPPORTED = (
    "Yahoo Finance provider supports NSE equities, ETFs and indices only "
    "(for an index, name it NIFTY50 or INDIAVIX, or use its Yahoo symbol such as ^NSEI)."
)


def yahoo_symbol_for(instrument: Instrument) -> str:
    """The instrument's Yahoo Finance symbol: SYMBOL.NS for NSE equities and ETFs,
    ^NSEI / ^INDIAVIX / ... for NSE indices."""
    if instrument.exchange is not Exchange.NSE:
        raise ValueError(UNSUPPORTED)
    if instrument.instrument_type in (InstrumentType.EQUITY, InstrumentType.ETF):
        return f"{instrument.symbol}.NS"
    if instrument.instrument_type is InstrumentType.INDEX:
        symbol = instrument.symbol.strip().upper()
        if symbol.startswith("^"):
            return symbol
        if symbol in INDEX_SYMBOLS:
            return INDEX_SYMBOLS[symbol]
    raise ValueError(UNSUPPORTED)


class YahooFinanceProvider(MarketDataProvider):
    def __init__(self, db):
        self.instrument_service = InstrumentService(db)

    def get_yahoo_symbol(
        self,
        *,
        instrument: Instrument,
    ) -> str:
        return yahoo_symbol_for(instrument)

    def fetch(
        self,
        *,
        instrument_id: UUID,
        start_timestamp: datetime,
        end_timestamp: datetime,
        timeframe,
    ) -> list[MarketDataPoint]:
        instrument = self.instrument_service.get_required_instrument(
            instrument_id=instrument_id,
        )

        yahoo_symbol = self.get_yahoo_symbol(
            instrument=instrument,
        )

        interval_map = {
            "1M": "1m",
            "5M": "5m",
            "15M": "15m",
            "1H": "1h",
            "1D": "1d",
        }

        interval = interval_map.get(
            timeframe.value if hasattr(timeframe, "value") else timeframe
        )

        if interval is None:
            raise ValueError(
                f"Unsupported timeframe: {timeframe}"
            )

        data = yf.download(
            yahoo_symbol,
            start=start_timestamp,
            end=end_timestamp,
            interval=interval,
            auto_adjust=False,
            progress=False,
        )

        if data is None or data.empty:
            return []

        if isinstance(data.columns, pd.MultiIndex):
            data.columns = data.columns.get_level_values(0)

        required_columns = [
            "Open",
            "High",
            "Low",
            "Close",
            "Volume",
        ]

        missing_columns = [
            column
            for column in required_columns
            if column not in data.columns
        ]

        if missing_columns:
            raise ValueError(
                f"Yahoo Finance response is missing columns: {missing_columns}"
            )

        points: list[MarketDataPoint] = []

        for timestamp, row in data.iterrows():
            prices = [row["Open"], row["High"], row["Low"], row["Close"]]
            if any(pd.isna(value) for value in prices):
                continue  # Yahoo leaves some index days without prices
            if timestamp.tzinfo is None:
                timestamp = timestamp.tz_localize("UTC")
            else:
                timestamp = timestamp.tz_convert("UTC")

            points.append(
                MarketDataPoint(
                    timestamp=timestamp.to_pydatetime(),
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    # Indices such as India VIX have no volume.
                    volume=0 if pd.isna(row["Volume"]) else int(row["Volume"]),
                )
            )

        return points
