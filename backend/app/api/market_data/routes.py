from datetime import date, datetime, time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.config import settings
from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import Timeframe
from app.models import User
from app.providers.market_data import MarketDataProvider, YahooFinanceProvider
from app.schemas.market_data import (
    MarketDataCoverage,
    MarketDataImportRequest,
    MarketDataImportResult,
    MarketDataRow,
)
from app.services.instruments.instrument_service import InstrumentService
from app.services.market_data import MarketDataService
from app.services.market_data.coverage import (
    IST,
    check_quality,
    check_trading_days,
    today_ist,
)
from app.services.market_data.importer import MarketDataImporter, ProviderUnavailableError

# Shares the /instruments prefix: market data always belongs to one instrument.
router = APIRouter(
    prefix="/instruments/{instrument_id}/market-data",
    tags=["Market Data"],
)

MAX_ROWS = 20_000


def get_market_data_provider(db: Session = Depends(get_db)) -> MarketDataProvider:
    """The configured provider (replaced in tests)."""
    return YahooFinanceProvider(db)


def _require_instrument(db: Session, instrument_id: UUID):
    instrument = InstrumentService(db).get_instrument(instrument_id=instrument_id)
    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instrument not found.",
        )
    return instrument


def _check_range(start: date | None, end: date | None) -> None:
    if start is not None and end is not None and end < start:
        raise HTTPException(
            status_code=422,
            detail="end_date must be on or after start_date.",
        )


def _bounds(start: date | None, end: date | None):
    """Whole IST days: start_date 00:00 to end_date 23:59:59.999999."""
    return (
        datetime.combine(start, time.min, tzinfo=IST) if start else None,
        datetime.combine(end, time.max, tzinfo=IST) if end else None,
    )


@router.get("", response_model=list[MarketDataRow])
def list_market_data(
    instrument_id: UUID,
    timeframe: Timeframe = Query(default=Timeframe.ONE_DAY),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stored OHLCV bars for the instrument, oldest first."""
    _require_instrument(db, instrument_id)
    _check_range(start_date, end_date)
    start, end = _bounds(start_date, end_date)

    rows = MarketDataService(db).list_market_data(
        instrument_id=instrument_id,
        start_timestamp=start,
        end_timestamp=end,
        timeframe=timeframe,
    )
    if len(rows) > MAX_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"This range has {len(rows)} rows (limit {MAX_ROWS}). Choose a shorter range.",
        )
    return [
        MarketDataRow(
            timestamp=row.timestamp,
            open=row.open,
            high=row.high,
            low=row.low,
            close=row.close,
            volume=row.volume,
        )
        for row in rows
    ]


@router.get("/coverage", response_model=MarketDataCoverage)
def get_coverage(
    instrument_id: UUID,
    timeframe: Timeframe = Query(default=Timeframe.ONE_DAY),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    What is stored for the instrument: row count, first and last bar, when data was
    last imported, expected NSE trading days without data, and data-quality checks.
    """
    _require_instrument(db, instrument_id)
    _check_range(start_date, end_date)
    start, end = _bounds(start_date, end_date)

    rows = MarketDataService(db).list_market_data(
        instrument_id=instrument_id,
        start_timestamp=start,
        end_timestamp=end,
        timeframe=timeframe,
    )

    return MarketDataCoverage(
        instrument_id=instrument_id,
        timeframe=timeframe,
        provider=settings.market_data_provider,
        requested_start=start_date,
        requested_end=end_date,
        row_count=len(rows),
        first_timestamp=rows[0].timestamp if rows else None,
        last_timestamp=rows[-1].timestamp if rows else None,
        last_imported_at=max((row.created_at for row in rows), default=None),
        trading_days=check_trading_days(
            rows, timeframe=timeframe, start=start_date, end=end_date
        ),
        quality=check_quality(rows),
    )


@router.post("/import", response_model=MarketDataImportResult)
def import_market_data(
    instrument_id: UUID,
    request: MarketDataImportRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    provider: MarketDataProvider = Depends(get_market_data_provider),
):
    """
    Downloads daily bars from the provider for the date range and stores the new ones.
    Historical data only: the range cannot end after today (IST).
    """
    _require_instrument(db, instrument_id)
    _check_range(request.start_date, request.end_date)
    if request.end_date > today_ist():
        raise HTTPException(
            status_code=422,
            detail="end_date cannot be after today.",
        )

    importer = MarketDataImporter(db, provider, settings.market_data_provider)
    try:
        return importer.run(
            instrument_id=instrument_id,
            start_date=request.start_date,
            end_date=request.end_date,
        )
    except ProviderUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not get data from the market data provider. "
            "Check the internet connection and try again.",
        ) from exc
    except ValueError as exc:
        # e.g. "Yahoo Finance provider currently supports NSE equity instruments only."
        raise HTTPException(status_code=422, detail=str(exc)) from exc
