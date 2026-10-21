from datetime import date, datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.data.calendars import NSEMarketCalendar
from app.enums import Timeframe
from app.services.market_data.calendar_audit import audit_calendar
from app.services.market_data.coverage import check_trading_days

CAL = NSEMarketCalendar()


def test_known_years_cover_2015_to_2026():
    assert CAL.known_holiday_years == set(range(2015, 2027))


def test_every_listed_holiday_is_a_weekday_in_its_own_year():
    for year, days in CAL._HOLIDAYS.items():
        for day in days:
            assert day.year == year
            assert day.weekday() < 5, day


def test_holidays_from_the_circulars_and_in_year_changes():
    for day in [
        date(2020, 2, 21),  # Mahashivratri
        date(2019, 4, 29),  # Mumbai general election
        date(2023, 6, 29),  # Bakri Id, moved from 28 Jun
        date(2024, 1, 22),  # declared holiday
        date(2024, 5, 20),  # Mumbai Lok Sabha election
        date(2024, 11, 20),  # Maharashtra assembly election
        date(2025, 10, 2),
    ]:
        assert not CAL.is_trading_day(day), day
    assert CAL.is_trading_day(date(2023, 6, 28))  # open after the change


def test_special_sessions_are_not_regular_trading_days():
    for day in [date(2020, 11, 14), date(2024, 1, 20), date(2025, 2, 1), date(2025, 10, 21)]:
        assert CAL.is_special_session(day)
        assert not CAL.is_trading_day(day)


def bar(day: date, instrument, volume: int = 1000):
    return SimpleNamespace(
        instrument_id=instrument,
        timestamp=datetime(day.year, day.month, day.day, tzinfo=timezone.utc),
        open=1.0, high=1.0, low=1.0, close=1.0, volume=volume,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


def test_coverage_does_not_count_2020_holidays_as_missing_or_flag_muhurat():
    # 9-16 Mar 2020: 10 Mar is Holi. A Muhurat bar on Sat 14 Nov 2020 is fine.
    days = [date(2020, 3, d) for d in (9, 11, 12, 13, 16)]
    rows = [bar(d, "a") for d in days] + [bar(date(2020, 11, 14), "a")]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2020, 3, 9), end=date(2020, 3, 16),
        today=date(2026, 10, 16),
    )
    assert (check.expected_days, check.missing_days, check.note) == (5, 0, None)
    full = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2020, 11, 13), end=date(2020, 11, 17),
        today=date(2026, 10, 16),
    )
    assert full.closed_days_with_data == []


def test_older_years_still_get_the_note():
    rows = [bar(date(2014, 6, 2), "a")]
    check = check_trading_days(
        rows, timeframe=Timeframe.ONE_DAY, start=date(2014, 6, 2), end=date(2014, 6, 6),
        today=date(2026, 10, 16),
    )
    assert check.note and "2014" in check.note


def test_audit_finds_bars_on_holidays_and_days_nobody_traded():
    a, b = uuid4(), uuid4()
    trading = CAL.trading_days(date(2025, 3, 10), date(2025, 3, 21))
    gap = date(2025, 3, 18)  # pretend this was an unlisted holiday
    rows = [bar(d, i) for d in trading if d != gap for i in (a, b)]
    rows.append(bar(date(2025, 3, 14), a, volume=0))  # Holi, a zero-volume bar
    rows.append(bar(date(2025, 2, 1), a))  # Budget Saturday session
    audit = audit_calendar(rows)
    assert audit.instruments == 2
    assert [(c.day, c.instruments, c.zero_volume_bars) for c in audit.closed_days_with_bars] == [
        (date(2025, 3, 14), 1, 1)
    ]
    assert audit.trading_days_without_bars == [gap]
    assert audit.special_sessions_with_bars == [date(2025, 2, 1)]
