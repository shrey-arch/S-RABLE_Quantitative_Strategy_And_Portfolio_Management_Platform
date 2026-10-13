from datetime import datetime
from uuid import UUID

import pandas as pd
import yfinance as yf

from app.enums import Exchange, InstrumentType
from app.models import Instrument
from app.providers.market_data.base import MarketDataProvider
from app.providers.market_data.schemas import MarketDataPoint
from app.services.instruments.instrument_service import InstrumentService


class YahooFinanceProvider(MarketDataProvider):
    def __init__(self, db):
        self.instrument_service = InstrumentService(db)

    def get_yahoo_symbol(
        self,
        *,
        instrument: Instrument,
    ) -> str:
        if (
            instrument.exchange is not Exchange.NSE
            or instrument.instrument_type is not InstrumentType.EQUITY
        ):
            raise ValueError(
                "Yahoo Finance provider currently supports NSE equity instruments only."
            )

        return f"{instrument.symbol}.NS"

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
                    volume=int(row["Volume"]),
                )
            )

        return points
