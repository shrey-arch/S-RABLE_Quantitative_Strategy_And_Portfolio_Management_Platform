from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import delete

from app.core.dependencies import get_current_user
from app.db import SessionLocal
from app.enums import Exchange, InstrumentType, Timeframe
from app.main import app
from app.models import Instrument, MarketData, User
from app.quant.indicators.catalogue import INDICATORS, validate_indicator
from app.quant.indicators.sma import SMA
from app.schemas.strategies.config import StrategyConfig
from app.services.instruments.instrument_service import InstrumentService

client = TestClient(app)

CLOSES = [100, 102, 101, 105, 107, 106, 110, 108, 111, 115, 113, 117]
START = datetime(2026, 1, 5, tzinfo=timezone.utc)  # a Monday


@pytest.fixture
def logged_in():
    app.dependency_overrides[get_current_user] = lambda: User(id=uuid4(), email="ind@example.com")
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def instrument_with_bars():
    db = SessionLocal()
    created = InstrumentService(db).create_instrument(
        symbol="TESTIND",
        trading_symbol=f"TESTIND-{uuid4().hex[:8]}",
        name="Indicator test",
        exchange=Exchange.NSE,
        instrument_type=InstrumentType.EQUITY,
        isin=None,
        lot_size=1,
        tick_size=0.05,
    )
    stamps = [START + timedelta(days=i) for i in range(len(CLOSES))]
    for ts, close in zip(stamps, CLOSES):
        db.add(
            MarketData(
                instrument_id=created.id, timestamp=ts, timeframe=Timeframe.ONE_DAY,
                open=close, high=close + 1, low=close - 1, close=close, volume=1000,
            )
        )
    db.commit()
    try:
        yield created, stamps
    finally:
        db.execute(delete(MarketData).where(MarketData.instrument_id == created.id))
        db.execute(delete(Instrument).where(Instrument.id == created.id))
        db.commit()
        db.close()


def test_indicator_routes_require_login():
    assert client.get("/indicators").status_code == 401
    assert client.post("/indicators/SMA/validate", json={}).status_code == 401
    assert client.post(f"/instruments/{uuid4()}/indicators/SMA", json={}).status_code == 401


def test_catalogue_lists_every_indicator_with_parameters(logged_in):
    body = client.get("/indicators").json()
    assert [i["key"] for i in body] == list(INDICATORS)
    macd = next(i for i in body if i["key"] == "MACD")
    assert macd["panel"] == "separate"
    assert macd["outputs"] == ["macd", "signal", "histogram"]
    assert [(p["name"], p["default"], p["required"]) for p in macd["parameters"]] == [
        ("fast_period", 12, False),
        ("slow_period", 26, False),
        ("signal_period", 9, False),
    ]
    sma = next(i for i in body if i["key"] == "SMA")
    assert sma["parameters"][0] == {
        "name": "window", "type": "int", "description": "Number of bars averaged.",
        "required": True, "default": None, "minimum": 0.0, "exclusive_minimum": True,
    }
    assert sma["used_by"] == ["momentum"]
    assert client.get("/indicators/bollinger").json()["panel"] == "price"
    assert client.get("/indicators/NOPE").status_code == 404


@pytest.mark.parametrize(
    ("key", "params", "message"),
    [
        ("SMA", {}, "SMA needs window."),
        ("SMA", {"window": 0}, "window must be greater than 0."),
        ("SMA", {"window": 2.5}, "window must be a whole number."),
        ("SMA", {"window": True}, "window must be a number."),
        ("SMA", {"period": 20}, "SMA does not take period. Its parameters are: window."),
        ("MACD", {"fast_period": 30}, "fast_period must be less than slow_period."),
        ("BOLLINGER", {"num_std": -1}, "num_std must be at least 0."),
    ],
)
def test_validate_rejects_bad_parameters(logged_in, key, params, message):
    response = client.post(f"/indicators/{key}/validate", json={"parameters": params})
    assert response.status_code == 422
    assert response.json()["detail"] == message


def test_validate_fills_defaults(logged_in):
    body = client.post("/indicators/macd/validate", json={"parameters": {"fast_period": 5}}).json()
    assert body == {
        "key": "MACD",
        "parameters": {"fast_period": 5, "slow_period": 26, "signal_period": 9},
    }


def test_strategy_config_accepts_catalogue_types_only():
    def config(indicator):
        return {"parameters": {}, "indicators": [indicator], "entry_conditions": [], "exit_conditions": []}

    saved = StrategyConfig.model_validate(
        config({"name": "fast", "type": "sma", "parameters": {"window": 10}})
    )
    assert (saved.indicators[0].type, saved.indicators[0].parameters) == ("SMA", {"window": 10})

    with pytest.raises(ValidationError, match="Unknown indicator type 'FOO'"):
        StrategyConfig.model_validate(config({"name": "x", "type": "FOO", "parameters": {}}))
    with pytest.raises(ValidationError, match="Indicator 'x': SMA needs window"):
        StrategyConfig.model_validate(config({"name": "x", "type": "SMA", "parameters": {}}))


def test_every_indicator_computes_on_ohlc_data():
    data = pd.DataFrame(
        {"open": CLOSES, "high": [c + 1 for c in CLOSES], "low": [c - 1 for c in CLOSES], "close": CLOSES}
    )
    for key, spec in INDICATORS.items():
        params = {p.name: (p.default if p.default is not None else 3) for p in spec.parameters}
        if key == "MACD":
            params = {"fast_period": 2, "slow_period": 4, "signal_period": 2}
        _, values = validate_indicator(key, params)
        frame = spec.compute(data, values)
        assert list(frame.columns) == list(spec.outputs), key
        assert len(frame) == len(data), key


def test_series_matches_the_backend_class_and_aligns_with_bars(logged_in, instrument_with_bars):
    instrument, stamps = instrument_with_bars
    response = client.post(
        f"/instruments/{instrument.id}/indicators/SMA",
        json={"parameters": {"window": 3}, "start_date": "2026-01-08"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["panel"] == "price" and body["outputs"] == ["value"]
    expected = SMA(3).calculate(pd.DataFrame({"close": CLOSES}))
    # Bars before start_date are warm-up: the first returned point already has a value.
    points = body["points"]
    assert len(points) == len(CLOSES) - 3
    for i, point in enumerate(points, start=3):
        assert datetime.fromisoformat(point["timestamp"]) == stamps[i]
        assert point["values"]["value"] == pytest.approx(expected[i])


def test_series_returns_null_during_warm_up_and_all_outputs(logged_in, instrument_with_bars):
    instrument, _ = instrument_with_bars
    body = client.post(
        f"/instruments/{instrument.id}/indicators/BOLLINGER",
        json={"parameters": {"window": 5}},
    ).json()
    assert body["outputs"] == ["middle", "upper", "lower"]
    assert body["points"][0]["values"] == {"middle": None, "upper": None, "lower": None}
    assert body["points"][4]["values"]["middle"] == pytest.approx(sum(CLOSES[:5]) / 5)


def test_series_errors(logged_in, instrument_with_bars):
    instrument, _ = instrument_with_bars
    url = f"/instruments/{instrument.id}/indicators"
    assert client.post(f"{url}/NOPE", json={}).status_code == 404
    assert client.post(f"/instruments/{uuid4()}/indicators/SMA", json={"parameters": {"window": 3}}).status_code == 404
    bad = client.post(f"{url}/SMA", json={"parameters": {"window": -1}})
    assert (bad.status_code, bad.json()["detail"]) == (422, "window must be greater than 0.")
    empty = client.post(f"{url}/SMA", json={"parameters": {"window": 3}, "start_date": "2027-01-01"})
    assert empty.json()["points"] == []
