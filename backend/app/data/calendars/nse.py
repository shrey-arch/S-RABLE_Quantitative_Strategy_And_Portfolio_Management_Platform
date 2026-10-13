from datetime import date, timedelta


class NSEMarketCalendar:
    _HOLIDAYS_2026 = {
        date(2026, 1, 15),
        date(2026, 1, 26),
        date(2026, 3, 3),
        date(2026, 3, 26),
        date(2026, 3, 31),
        date(2026, 4, 3),
        date(2026, 4, 14),
        date(2026, 5, 1),
        date(2026, 5, 28),
        date(2026, 6, 26),
        date(2026, 9, 14),
        date(2026, 10, 2),
        date(2026, 10, 20),
        date(2026, 11, 10),
        date(2026, 11, 24),
        date(2026, 12, 25),
    }

    def is_trading_day(self, value: date) -> bool:
        if value.weekday() >= 5:
            return False

        return value not in self._HOLIDAYS_2026

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
