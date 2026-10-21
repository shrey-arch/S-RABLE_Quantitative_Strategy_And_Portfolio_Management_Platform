import logging
from collections import Counter
from datetime import date, datetime, time, timedelta
from uuid import UUID

from pydantic import ValidationError

from app.data.calendars import NSEMarketCalendar
from app.enums import Timeframe
from app.pipelines.market_data import normalize_market_data
from app.providers.market_data import MarketDataProvider
from app.repositories.market_data import MarketDataRepository
from app.schemas.market_data import MarketDataImportResult
from app.services.market_data.coverage import IST, trading_date

logger = logging.getLogger(__name__)

# market_data.volume is a 32-bit INTEGER column.
MAX_VOLUME = 2_147_483_647
PLACEHOLDER_REASON = "zero-volume placeholder on a day NSE was closed"
_CALENDAR = NSEMarketCalendar()


def is_closed_day_placeholder(point, calendar: NSEMarketCalendar = _CALENDAR) -> bool:
    """
    Yahoo sometimes returns a bar with zero volume on an exchange holiday (the
    previous close repeated). Such a bar is not a trading session. Special sessions
    (Muhurat, Budget days) and years without a holiday list are left alone.
    """
    day = trading_date(point.timestamp)
    return (
        point.volume == 0
        and day.year in calendar.known_holiday_years
        and not calendar.is_trading_day(day)
        and not calendar.is_special_session(day)
    )


class ProviderUnavailableError(RuntimeError):
    """The data provider could not be reached or failed unexpectedly."""


class MarketDataImporter:
    """
    Fetches daily bars from a provider and stores the new ones.
    Bars already stored (same instrument, timestamp and timeframe) are skipped;
    bars that fail validation are counted and not stored.
    """

    timeframe = Timeframe.ONE_DAY

    def __init__(self, db, provider: MarketDataProvider, provider_name: str):
        self.repository = MarketDataRepository(db)
        self.provider = provider
        self.provider_name = provider_name

    def run(self, *, instrument_id: UUID, start_date: date, end_date: date) -> MarketDataImportResult:
        start = datetime.combine(start_date, time.min, tzinfo=IST)
        # The provider's end is exclusive: ask for the day after end_date.
        end = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=IST)

        try:
            points = self.provider.fetch(
                instrument_id=instrument_id,
                start_timestamp=start,
                end_timestamp=end,
                timeframe=self.timeframe,
            )
        except ValueError:
            raise
        except Exception as exc:  # network errors, provider library errors
            logger.exception("Market data provider failed for instrument %s", instrument_id)
            raise ProviderUnavailableError(str(exc)) from exc

        reasons: Counter[str] = Counter()
        valid = []
        for point in points:
            if point.volume > MAX_VOLUME:
                reasons["volume too large to store"] += 1
                continue
            if is_closed_day_placeholder(point):
                reasons[PLACEHOLDER_REASON] += 1
                continue
            try:
                valid.extend(
                    normalize_market_data(
                        instrument_id=instrument_id,
                        timeframe=self.timeframe,
                        points=[point],
                    )
                )
            except ValidationError as exc:
                reasons[exc.errors()[0].get("msg", "invalid bar")] += 1

        inserted = self.repository.insert_ignoring_existing(valid)

        return MarketDataImportResult(
            instrument_id=instrument_id,
            provider=self.provider_name,
            timeframe=self.timeframe,
            start_date=start_date,
            end_date=end_date,
            fetched=len(points),
            inserted=inserted,
            skipped_existing=len(valid) - inserted,
            rejected=sum(reasons.values()),
            rejected_reasons=dict(reasons),
        )
