from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

from app.data.calendars import NSEMarketCalendar
from app.data.validators import (
    find_duplicate_timestamps,
    find_invalid_prices,
    find_invalid_volume,
    find_missing_values,
)
from app.enums import Timeframe
from app.schemas.market_data import DataQuality, MissingPeriod, TradingDayCheck

IST = ZoneInfo("Asia/Kolkata")
MAX_MISSING_PERIODS = 50
REQUIRED_COLUMNS = ["open", "high", "low", "close", "volume"]
PRICE_COLUMNS = ["open", "high", "low", "close"]


def trading_date(timestamp: datetime) -> date:
    """
    The NSE session a bar belongs to. Daily bars may be stored at 00:00 UTC or at
    00:00 IST (18:30 UTC the day before); reading the time in IST gives the right
    day in both cases.
    """
    return timestamp.astimezone(IST).date()


def today_ist() -> date:
    return datetime.now(IST).date()


def _periods(days: list[date]) -> list[MissingPeriod]:
    """Groups missing trading days into runs (consecutive in the trading calendar)."""
    return [MissingPeriod(start=run[0], end=run[-1], days=len(run)) for run in _runs(days)]


def _runs(days: list[date]):
    run: list[date] = []
    for day in days:
        if run and day != run[-1] + timedelta(days=1) and not _only_closed_days_between(
            run[-1], day
        ):
            yield run
            run = []
        run.append(day)
    if run:
        yield run


_CALENDAR = NSEMarketCalendar()


def _only_closed_days_between(a: date, b: date) -> bool:
    day = a + timedelta(days=1)
    while day < b:
        if _CALENDAR.is_trading_day(day):
            return False
        day += timedelta(days=1)
    return True


def check_trading_days(
    rows,
    *,
    timeframe: Timeframe,
    start: date | None,
    end: date | None,
    calendar: NSEMarketCalendar | None = None,
    today: date | None = None,
) -> TradingDayCheck:
    calendar = calendar or _CALENDAR
    known_years = sorted(calendar.known_holiday_years)

    if timeframe is not Timeframe.ONE_DAY:
        return TradingDayCheck(
            checked=False,
            holidays_known_for_years=known_years,
            note="The trading-day check is done for daily (1D) data only.",
        )

    dates_with_data = {trading_date(row.timestamp) for row in rows}
    range_start = start or (min(dates_with_data) if dates_with_data else None)
    range_end = end or (max(dates_with_data) if dates_with_data else None)
    if range_start is None or range_end is None:
        return TradingDayCheck(
            checked=False,
            holidays_known_for_years=known_years,
            note="No date range and no stored data, so there is nothing to check.",
        )

    # Days after today cannot have data yet.
    last_day = min(range_end, today or today_ist())
    expected = calendar.trading_days(range_start, last_day)
    missing = [day for day in expected if day not in dates_with_data]
    periods = _periods(missing)
    closed_with_data = sorted(
        day
        for day in dates_with_data
        if range_start <= day <= last_day
        and not calendar.is_trading_day(day)
        and not calendar.is_special_session(day)
    )

    unknown_years = sorted(
        {range_start.year, last_day.year, *range(range_start.year, last_day.year + 1)}
        - set(known_years)
    )
    note = None
    if unknown_years:
        note = (
            "NSE holidays are listed only for "
            + ", ".join(str(y) for y in known_years)
            + ". For "
            + ", ".join(str(y) for y in unknown_years)
            + " every weekday counts as a trading day, so exchange holidays there show as missing."
        )

    return TradingDayCheck(
        checked=True,
        range_start=range_start,
        range_end=range_end,
        expected_days=len(expected),
        days_with_data=len(expected) - len(missing),
        missing_days=len(missing),
        missing_periods=periods[:MAX_MISSING_PERIODS],
        missing_periods_truncated=len(periods) > MAX_MISSING_PERIODS,
        closed_days_with_data=closed_with_data[:MAX_MISSING_PERIODS],
        holidays_known_for_years=known_years,
        note=note,
    )


def check_quality(rows) -> DataQuality:
    """Runs the backend's dataset validators on stored rows."""
    frame = pd.DataFrame(
        [
            {
                "timestamp": row.timestamp,
                "open": row.open,
                "high": row.high,
                "low": row.low,
                "close": row.close,
                "volume": row.volume,
            }
            for row in rows
        ],
        columns=["timestamp", *REQUIRED_COLUMNS],
    )
    if not frame.empty:
        frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    frame = frame.set_index("timestamp")

    volume = find_invalid_volume(frame)
    return DataQuality(
        missing_values=find_missing_values(frame, REQUIRED_COLUMNS).columns,
        duplicate_timestamps=len(find_duplicate_timestamps(frame).timestamps),
        invalid_prices=find_invalid_prices(frame, PRICE_COLUMNS).columns,
        zero_volume_rows=volume.zero_count,
        negative_volume_rows=volume.negative_count,
    )
