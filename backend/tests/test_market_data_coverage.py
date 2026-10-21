from datetime import date, datetime, timezone
from types import SimpleNamespace

from app.enums import Timeframe
from app.services.market_data.coverage import (
    check_quality,
    check_trading_days,
    trading_date,
)


def bar(day: date, *, hour_utc: int = 0, minute: int = 0, volume: int = 1000, close: float = 100.0):
    return SimpleNamespace(
        timestamp=datetime(day.year, day.month, day.day, hour_utc, minute, tzinfo=timezone.utc),
        open=100.0,
        high=101.0,
        low=99.0,
        close=close,
        volume=volume,
        created_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
    )


def test_trading_date_reads_the_ist_session():
    # 00:00 UTC and 18:30 UTC of the previous day are both the same IST trading day.
    assert trading_date(datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)) == date(2026, 1, 5)
    assert trading_date(datetime(2026, 1, 4, 18, 30, tzinfo=timezone.utc)) == date(2026, 1, 5)


def test_full_week_has_no_missing_days():
    # 5-9 Jan 2026: Monday to Friday, no NSE holidays.
    rows = [bar(date(2026, 1, d)) for d in range(5, 10)]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2026, 1, 5), end=date(2026, 1, 11),
        today=date(2026, 10, 16),
    )
    assert check.checked
    assert (check.expected_days, check.days_with_data, check.missing_days) == (5, 5, 0)
    assert check.note is None


def test_holidays_and_weekends_are_not_missing_and_gaps_are_grouped():
    # 12-16 Jan 2026; 15 Jan is an NSE holiday. Data only on 12 Jan.
    # Missing: 13, 14, 16 Jan -> one period (the holiday between does not break it).
    rows = [bar(date(2026, 1, 12))]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2026, 1, 12), end=date(2026, 1, 18),
        today=date(2026, 10, 16),
    )
    assert check.expected_days == 4
    assert check.missing_days == 3
    assert [(p.start, p.end, p.days) for p in check.missing_periods] == [
        (date(2026, 1, 13), date(2026, 1, 16), 3)
    ]


def test_days_after_today_are_not_counted_as_missing():
    rows = [bar(date(2026, 10, 15))]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2026, 10, 15), end=date(2026, 12, 31),
        today=date(2026, 10, 15),
    )
    assert (check.expected_days, check.missing_days) == (1, 0)


def test_years_without_holiday_data_are_flagged():
    rows = [bar(date(2014, 1, 6))]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2014, 1, 6), end=date(2014, 1, 6),
        today=date(2026, 10, 16),
    )
    assert check.holidays_known_for_years == list(range(2015, 2027))
    assert "2014" in check.note


def test_range_defaults_to_the_stored_data():
    rows = [bar(date(2026, 1, 5)), bar(date(2026, 1, 7))]
    check = check_trading_days(rows, timeframe=Timeframe.ONE_DAY, start=None, end=None, today=date(2026, 10, 16))
    assert (check.range_start, check.range_end) == (date(2026, 1, 5), date(2026, 1, 7))
    assert check.missing_days == 1


def test_no_data_and_no_range_is_not_checked():
    check = check_trading_days([], timeframe=Timeframe.ONE_DAY, start=None, end=None)
    assert not check.checked


def test_intraday_is_not_checked():
    check = check_trading_days([bar(date(2026, 1, 5))], timeframe=Timeframe.ONE_HOUR, start=None, end=None)
    assert not check.checked
    assert "daily" in check.note


def test_quality_runs_the_dataset_validators():
    day = date(2026, 1, 5)
    rows = [bar(day, volume=0), bar(day), bar(date(2026, 1, 6), close=float("nan"))]
    quality = check_quality(rows)
    assert quality.zero_volume_rows == 1
    assert quality.negative_volume_rows == 0
    assert quality.duplicate_timestamps == 1
    assert quality.missing_values == {"close": 1}
    assert quality.invalid_prices == {}


def test_quality_of_no_rows_is_clean():
    quality = check_quality([])
    assert quality.duplicate_timestamps == 0
    assert quality.missing_values == {}


def test_rows_on_closed_days_are_listed():
    # 26 Jan 2026 is an NSE holiday; 24 Jan is a Saturday. Both have a bar here.
    rows = [bar(date(2026, 1, d)) for d in (23, 24, 26, 27)]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2026, 1, 23), end=date(2026, 1, 27),
        today=date(2026, 10, 16),
    )
    assert check.closed_days_with_data == [date(2026, 1, 24), date(2026, 1, 26)]
    assert (check.expected_days, check.days_with_data, check.missing_days) == (2, 2, 0)
