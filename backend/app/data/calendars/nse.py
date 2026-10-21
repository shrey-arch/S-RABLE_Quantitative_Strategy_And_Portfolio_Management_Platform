from datetime import date, timedelta


def _days(year: int, *month_days: str) -> set[date]:
    return {date(year, int(md[:2]), int(md[3:])) for md in month_days}


class NSEMarketCalendar:
    """
    NSE equity (capital market) trading calendar.

    Weekday trading holidays come from NSE's yearly holiday circulars, plus the
    holidays NSE declared or moved during the year (elections, the 2023 Bakri Id
    change, 22 Jan 2024). Holidays that fall on a weekend are not listed: weekends
    are closed anyway.

    Sources (equity / capital market segment):
      2021 NSE/CMTR/46623, 2022 NSE/CMTR/50560, 2024 NSE/CMTR/59722,
      2025 NSE/CMTR/65587; 2015-2020 and 2023 from the yearly circulars as
      published by brokers. In-year changes: 29 Apr 2019 and 21 Oct 2019
      (elections), 29 Jun 2023 (Bakri Id moved from 28 Jun), 22 Jan 2024,
      20 May 2024 and 20 Nov 2024 (elections), 15 Jan 2026 (civic elections).
    """

    _HOLIDAYS: dict[int, set[date]] = {
        2015: _days(
            2015, "01-26", "02-17", "03-06", "04-02", "04-03", "04-14", "05-01", "09-17",
            "09-25", "10-02", "10-22", "11-11", "11-12", "11-25", "12-25",
        ),
        2016: _days(
            2016, "01-26", "03-07", "03-24", "03-25", "04-14", "04-15", "04-19", "07-06",
            "08-15", "09-05", "09-13", "10-11", "10-12", "10-31", "11-14",
        ),
        2017: _days(
            2017, "01-26", "02-24", "03-13", "04-04", "04-14", "05-01", "06-26", "08-15",
            "08-25", "10-02", "10-19", "10-20", "12-25",
        ),
        2018: _days(
            2018, "01-26", "02-13", "03-02", "03-29", "03-30", "05-01", "08-15", "08-22",
            "09-13", "09-20", "10-02", "10-18", "11-07", "11-08", "11-23", "12-25",
        ),
        2019: _days(
            2019, "03-04", "03-21", "04-17", "04-19", "04-29", "05-01", "06-05", "08-12",
            "08-15", "09-02", "09-10", "10-02", "10-08", "10-21", "10-28", "11-12", "12-25",
        ),
        2020: _days(
            2020, "02-21", "03-10", "04-02", "04-06", "04-10", "04-14", "05-01", "05-25",
            "10-02", "11-16", "11-30", "12-25",
        ),
        2021: _days(
            2021, "01-26", "03-11", "03-29", "04-02", "04-14", "04-21", "05-13", "07-21",
            "08-19", "09-10", "10-15", "11-04", "11-05", "11-19",
        ),
        2022: _days(
            2022, "01-26", "03-01", "03-18", "04-14", "04-15", "05-03", "08-09", "08-15",
            "08-31", "10-05", "10-24", "10-26", "11-08",
        ),
        2023: _days(
            2023, "01-26", "03-07", "03-30", "04-04", "04-07", "04-14", "05-01", "06-29",
            "08-15", "09-19", "10-02", "10-24", "11-14", "11-27", "12-25",
        ),
        2024: _days(
            2024, "01-22", "01-26", "03-08", "03-25", "03-29", "04-11", "04-17", "05-01",
            "05-20", "06-17", "07-17", "08-15", "10-02", "11-01", "11-15", "11-20", "12-25",
        ),
        2025: _days(
            2025, "02-26", "03-14", "03-31", "04-10", "04-14", "04-18", "05-01", "08-15",
            "08-27", "10-02", "10-21", "10-22", "11-05", "12-25",
        ),
        2026: _days(
            2026, "01-15", "01-26", "03-03", "03-26", "03-31", "04-03", "04-14", "05-01",
            "05-28", "06-26", "09-14", "10-02", "10-20", "11-10", "11-24", "12-25",
        ),
    }

    # Sessions held on a holiday or a weekend: Diwali Muhurat trading (a short
    # evening session) and special Saturday/Sunday sessions (Union Budget days,
    # 20 Jan 2024, the 2 Mar 2024 disaster-recovery test session). A bar on one of
    # these days is real, but no bar is expected.
    _SPECIAL_SESSIONS: set[date] = {
        date(2015, 2, 28),  # Saturday, Union Budget
        date(2015, 11, 11),  # Muhurat
        date(2016, 10, 30),  # Muhurat (Sunday)
        date(2017, 10, 19),  # Muhurat
        date(2018, 11, 7),  # Muhurat
        date(2019, 10, 27),  # Muhurat (Sunday)
        date(2020, 2, 1),  # Saturday, Union Budget
        date(2020, 11, 14),  # Muhurat (Saturday)
        date(2021, 11, 4),  # Muhurat
        date(2022, 10, 24),  # Muhurat
        date(2023, 11, 12),  # Muhurat (Sunday)
        date(2024, 1, 20),  # Saturday, full session before the 22 Jan holiday
        date(2024, 3, 2),  # Saturday, disaster-recovery test session
        date(2024, 11, 1),  # Muhurat
        date(2025, 2, 1),  # Saturday, Union Budget
        date(2025, 10, 21),  # Muhurat
        date(2026, 2, 1),  # Sunday, Union Budget
    }

    @property
    def known_holiday_years(self) -> set[int]:
        """Years whose exchange holidays are listed above."""
        return set(self._HOLIDAYS)

    def is_holiday(self, value: date) -> bool:
        return value in self._HOLIDAYS.get(value.year, set())

    def is_special_session(self, value: date) -> bool:
        """A session held on a holiday or weekend (Muhurat, Budget day...)."""
        return value in self._SPECIAL_SESSIONS

    def is_trading_day(self, value: date) -> bool:
        """A regular session is expected on this day."""
        if value.weekday() >= 5:
            return False

        return not self.is_holiday(value)

    def trading_days(
        self,
        start_date: date,
        end_date: date,
    ) -> list[date]:
        if end_date < start_date:
            return []

        days = []
        current = start_date

        while current <= end_date:
            if self.is_trading_day(current):
                days.append(current)

            current += timedelta(days=1)

        return days
