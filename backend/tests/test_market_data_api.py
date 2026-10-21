from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.api.market_data.routes import get_market_data_provider
from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType
from app.main import app
from app.models import Instrument, MarketData, User
from app.providers.market_data import MarketDataPoint
from app.services.instruments.instrument_service import InstrumentService

client = TestClient(app)


def point(day: date, close: float = 100.0, **over) -> MarketDataPoint:
    values = dict(
        timestamp=datetime(day.year, day.month, day.day, tzinfo=timezone.utc),
        open=100.0,
        high=max(101.0, close),
        low=min(99.0, close),
        close=close,
        volume=1000,
    )
    values.update(over)
    return MarketDataPoint.model_construct(**values)


class FakeProvider:
    def __init__(self, points=None, error: Exception | None = None):
        self.points = points or []
        self.error = error
        self.calls = []

    def fetch(self, *, instrument_id, start_timestamp, end_timestamp, timeframe):
        self.calls.append((instrument_id, start_timestamp, end_timestamp, timeframe))
        if self.error:
            raise self.error
        return list(self.points)


@pytest.fixture
def instrument():
    db = SessionLocal()
    created = InstrumentService(db).create_instrument(
        symbol="TESTMD",
        trading_symbol=f"TESTMD-{uuid4().hex[:8]}",
        name="Market data test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    try:
        yield created
    finally:
        db.execute(delete(MarketData).where(MarketData.instrument_id == created.id))
        db.execute(delete(Instrument).where(Instrument.id == created.id))
        db.commit()
        db.close()


@pytest.fixture
def logged_in():
    app.dependency_overrides[get_current_user] = lambda: User(id=uuid4(), email="md@example.com")
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_market_data_provider, None)


def use_provider(provider):
    app.dependency_overrides[get_market_data_provider] = lambda: provider
    return provider


def do_import(instrument_id, start="2026-01-05", end="2026-01-09"):
    return client.post(
        f"/instruments/{instrument_id}/market-data/import",
        json={"start_date": start, "end_date": end},
    )


def test_market_data_routes_require_login(instrument):
    base = f"/instruments/{instrument.id}/market-data"
    assert client.get(base).status_code == 401
    assert client.get(f"{base}/coverage").status_code == 401
    assert client.post(f"{base}/import", json={}).status_code == 401


def test_unknown_instrument_is_404(logged_in):
    base = f"/instruments/{uuid4()}/market-data"
    assert client.get(base).status_code == 404
    assert client.get(f"{base}/coverage").status_code == 404
    use_provider(FakeProvider())
    assert do_import(uuid4()).status_code == 404


def test_import_stores_bars_and_skips_them_the_second_time(logged_in, instrument):
    provider = use_provider(FakeProvider([point(date(2026, 1, d)) for d in range(5, 10)]))

    first = do_import(instrument.id)
    assert first.status_code == 200
    body = first.json()
    assert (body["fetched"], body["inserted"], body["skipped_existing"], body["rejected"]) == (5, 5, 0, 0)
    assert body["timeframe"] == "1D"

    # The provider's end is exclusive, so it is asked for the day after end_date.
    _, start, end, timeframe = provider.calls[0]
    assert (start.date(), end.date(), timeframe.value) == (date(2026, 1, 5), date(2026, 1, 10), "1D")

    second = do_import(instrument.id).json()
    assert (second["inserted"], second["skipped_existing"]) == (0, 5)


def test_import_rejects_bad_bars_and_keeps_good_ones(logged_in, instrument):
    use_provider(
        FakeProvider(
            [
                point(date(2026, 1, 5)),
                point(date(2026, 1, 6), high=90.0),  # high below low
                point(date(2026, 1, 7), volume=3_000_000_000),  # too large for the column
            ]
        )
    )
    body = do_import(instrument.id).json()
    assert (body["fetched"], body["inserted"], body["rejected"]) == (3, 1, 2)
    assert body["rejected_reasons"]["volume too large to store"] == 1


def test_import_skips_zero_volume_placeholders_on_holidays(logged_in, instrument):
    use_provider(
        FakeProvider(
            [
                point(date(2026, 1, 14)),
                point(date(2026, 1, 15), volume=0),  # NSE holiday: placeholder bar
                point(date(2026, 1, 16), volume=0),  # trading day: kept, flagged by quality
                point(date(2026, 2, 1), volume=0),  # Sunday Budget session: kept
            ]
        )
    )
    body = do_import(instrument.id, start="2026-01-14", end="2026-02-02").json()
    assert (body["fetched"], body["inserted"], body["rejected"]) == (4, 3, 1)
    assert body["rejected_reasons"] == {"zero-volume placeholder on a day NSE was closed": 1}


def test_reading_an_instrument_does_not_load_its_bars():
    from sqlalchemy import inspect

    from app.models import Instrument, MarketData

    relationships = inspect(Instrument).relationships
    for name in ("market_data", "orders", "positions", "executions"):
        assert relationships[name].lazy == "select", name
    assert inspect(MarketData).relationships["instrument"].lazy == "select"


def test_rows_match_what_was_stored(logged_in, instrument):
    use_provider(FakeProvider([point(date(2026, 1, d), close=100.0 + d) for d in range(5, 10)]))
    do_import(instrument.id)

    rows = client.get(
        f"/instruments/{instrument.id}/market-data",
        params={"start_date": "2026-01-06", "end_date": "2026-01-08"},
    )
    assert rows.status_code == 200
    assert [r["close"] for r in rows.json()] == [106.0, 107.0, 108.0]
    assert list(rows.json()[0]) == ["timestamp", "open", "high", "low", "close", "volume"]


def test_coverage_reports_counts_gaps_and_quality(logged_in, instrument):
    # 5-9 Jan stored except 7 Jan; 7 Jan is a trading day, so it is missing.
    use_provider(FakeProvider([point(date(2026, 1, d)) for d in (5, 6, 8, 9)]))
    do_import(instrument.id)

    body = client.get(
        f"/instruments/{instrument.id}/market-data/coverage",
        params={"start_date": "2026-01-05", "end_date": "2026-01-09"},
    ).json()

    assert body["row_count"] == 4
    assert body["provider"] == "yahoo_finance"
    assert body["first_timestamp"].startswith("2026-01-05")
    assert body["last_timestamp"].startswith("2026-01-09")
    assert body["last_imported_at"] is not None
    days = body["trading_days"]
    assert (days["expected_days"], days["days_with_data"], days["missing_days"]) == (5, 4, 1)
    assert days["missing_periods"] == [{"start": "2026-01-07", "end": "2026-01-07", "days": 1}]
    assert body["quality"] == {
        "missing_values": {},
        "duplicate_timestamps": 0,
        "invalid_prices": {},
        "zero_volume_rows": 0,
        "negative_volume_rows": 0,
    }


def test_coverage_of_an_instrument_without_data(logged_in, instrument):
    body = client.get(f"/instruments/{instrument.id}/market-data/coverage").json()
    assert body["row_count"] == 0
    assert body["first_timestamp"] is None
    assert body["trading_days"]["checked"] is False


def test_import_errors(logged_in, instrument):
    use_provider(FakeProvider(error=ConnectionError("network down")))
    assert do_import(instrument.id).status_code == 502

    use_provider(FakeProvider(error=ValueError("Yahoo Finance provider currently supports NSE equity instruments only.")))
    response = do_import(instrument.id)
    assert response.status_code == 422
    assert "NSE equity" in response.json()["detail"]

    use_provider(FakeProvider())
    tomorrow = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    assert do_import(instrument.id, end=tomorrow).status_code == 422
    assert do_import(instrument.id, start="2026-01-09", end="2026-01-05").status_code == 422


def test_instrument_with_data_cannot_be_deleted(logged_in, instrument):
    use_provider(FakeProvider([point(date(2026, 1, 5))]))
    do_import(instrument.id)

    response = client.delete(f"/instruments/{instrument.id}")
    assert response.status_code == 409
    assert "Deactivate it instead" in response.json()["detail"]


def test_instrument_without_data_can_be_deleted(logged_in):
    db = SessionLocal()
    created = InstrumentService(db).create_instrument(
        symbol="TESTDEL",
        trading_symbol=f"TESTDEL-{uuid4().hex[:8]}",
        name="Delete me",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    db.close()
    assert client.delete(f"/instruments/{created.id}").status_code == 204
    assert client.get(f"/instruments/{created.id}").status_code == 404


def test_backtest_loader_reads_imported_rows(logged_in, instrument, tmp_path):
    """Regression: the timeframe enum must be stored and queried by value ("1D")."""
    from app.data.cache import MarketDatasetCache
    from app.data.loaders import MarketDatasetLoader
    from app.enums import Timeframe

    use_provider(FakeProvider([point(date(2026, 1, d)) for d in range(5, 10)]))
    do_import(instrument.id)

    db = SessionLocal()
    try:
        dataset = MarketDatasetLoader(db, cache=MarketDatasetCache(cache_dir=tmp_path)).load(
            instrument_id=instrument.id,
            frequency=Timeframe.ONE_DAY,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 1, 31),
        )
    finally:
        db.close()
    assert len(dataset.ohlcv) == 5
    assert list(dataset.ohlcv.columns) == ["open", "high", "low", "close", "volume"]
