from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.enums import Timeframe


class MarketDataRow(BaseModel):
    """One stored OHLCV bar."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int


class MissingPeriod(BaseModel):
    start: date
    end: date
    days: int


class TradingDayCheck(BaseModel):
    """Expected NSE trading days in the range compared with the stored rows."""

    checked: bool
    range_start: date | None = None
    range_end: date | None = None
    expected_days: int = 0
    days_with_data: int = 0
    missing_days: int = 0
    missing_periods: list[MissingPeriod] = []
    missing_periods_truncated: bool = False
    # Dates that have data although the calendar says NSE was closed
    # (a provider placeholder bar, or a calendar that is wrong for that day).
    closed_days_with_data: list[date] = []
    holidays_known_for_years: list[int] = []
    note: str | None = None


class DataQuality(BaseModel):
    """Results of app.data.validators on the stored rows."""

    missing_values: dict[str, int]
    duplicate_timestamps: int
    invalid_prices: dict[str, int]
    zero_volume_rows: int
    negative_volume_rows: int


class MarketDataCoverage(BaseModel):
    instrument_id: UUID
    timeframe: Timeframe
    provider: str
    requested_start: date | None
    requested_end: date | None
    row_count: int
    first_timestamp: datetime | None
    last_timestamp: datetime | None
    last_imported_at: datetime | None
    trading_days: TradingDayCheck
    quality: DataQuality


class MarketDataImportRequest(BaseModel):
    start_date: date
    end_date: date


class MarketDataImportResult(BaseModel):
    instrument_id: UUID
    provider: str
    timeframe: Timeframe
    start_date: date
    end_date: date
    fetched: int
    inserted: int
    skipped_existing: int
    rejected: int
    rejected_reasons: dict[str, int]
