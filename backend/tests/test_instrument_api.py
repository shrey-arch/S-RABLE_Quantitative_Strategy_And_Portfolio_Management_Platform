from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.enums import Exchange, InstrumentType
from app.models import User
from app.services.instruments.instrument_service import (
    IN_USE_MESSAGE,
    InstrumentInUseError,
)


client = TestClient(app)


@pytest.fixture(autouse=True)
def logged_in():
    """Instrument routes require login: every test here runs as a logged-in user."""
    app.dependency_overrides[get_current_user] = lambda: User(
        id=uuid4(), email="instrument-test@example.com"
    )
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.parametrize(
    "method, path",
    [
        ("get", "/instruments"),
        ("post", "/instruments"),
        ("get", f"/instruments/{uuid4()}"),
        ("patch", f"/instruments/{uuid4()}"),
        ("delete", f"/instruments/{uuid4()}"),
    ],
)
def test_instrument_routes_require_login(method, path):
    app.dependency_overrides.pop(get_current_user, None)  # no user for this test
    assert getattr(client, method)(path).status_code == 401


def test_delete_instrument_in_use_is_conflict():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService
    try:
        mock_service = MagicMock()
        mock_service.get_instrument.return_value = make_mock_instrument()
        mock_service.delete_instrument.side_effect = InstrumentInUseError(IN_USE_MESSAGE)
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.delete(f"/instruments/{uuid4()}")

        assert response.status_code == 409
        assert response.json()["detail"] == IN_USE_MESSAGE
    finally:
        instrument_routes.InstrumentService = original_service


def make_mock_instrument():
    instrument = MagicMock()

    instrument.id = uuid4()
    instrument.symbol = "RELIANCE"
    instrument.trading_symbol = "RELIANCE-EQ"
    instrument.name = "Reliance Industries"
    instrument.exchange = Exchange.NSE
    instrument.instrument_type = InstrumentType.EQUITY
    instrument.isin = "INE002A01018"
    instrument.lot_size = 1
    instrument.tick_size = 0.05
    instrument.is_active = True

    instrument.created_at = MagicMock()
    instrument.created_at.isoformat.return_value = (
        "2026-09-07T00:00:00+00:00"
    )

    instrument.updated_at = MagicMock()
    instrument.updated_at.isoformat.return_value = (
        "2026-09-07T00:00:00+00:00"
    )

    return instrument


def test_list_instruments():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        mock_service.list_instruments.return_value = [
            make_mock_instrument(),
        ]

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.get("/instruments")

        assert response.status_code == 200

        data = response.json()

        assert len(data) == 1
        assert data[0]["symbol"] == "RELIANCE"
        assert data[0]["trading_symbol"] == "RELIANCE-EQ"
        assert data[0]["name"] == "Reliance Industries"
        assert data[0]["exchange"] == "NSE"
        assert data[0]["instrument_type"] == "EQUITY"
        assert data[0]["is_active"] is True

        mock_service.list_instruments.assert_called_once_with(
            active_only=False,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_list_active_instruments():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        mock_service.list_instruments.return_value = [
            make_mock_instrument(),
        ]

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.get("/instruments?active_only=true")

        assert response.status_code == 200

        mock_service.list_instruments.assert_called_once_with(
            active_only=True,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_get_instrument():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        instrument = make_mock_instrument()
        instrument_id = instrument.id

        mock_service = MagicMock()
        mock_service.get_instrument.return_value = instrument

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.get(f"/instruments/{instrument_id}")

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(instrument_id)
        assert data["symbol"] == "RELIANCE"
        assert data["trading_symbol"] == "RELIANCE-EQ"

        mock_service.get_instrument.assert_called_once_with(
            instrument_id=instrument_id,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_get_instrument_not_found():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        mock_service.get_instrument.return_value = None

        instrument_routes.InstrumentService = lambda db: mock_service

        instrument_id = uuid4()

        response = client.get(f"/instruments/{instrument_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Instrument not found."

        mock_service.get_instrument.assert_called_once_with(
            instrument_id=instrument_id,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_create_instrument():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        instrument = make_mock_instrument()

        mock_service = MagicMock()
        mock_service.create_instrument.return_value = instrument

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "isin": "INE002A01018",
                "lot_size": 1,
                "tick_size": 0.05,
                "is_active": True,
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["symbol"] == "RELIANCE"
        assert data["trading_symbol"] == "RELIANCE-EQ"
        assert data["name"] == "Reliance Industries"
        assert data["exchange"] == "NSE"
        assert data["instrument_type"] == "EQUITY"

        mock_service.create_instrument.assert_called_once_with(
            symbol="RELIANCE",
            trading_symbol="RELIANCE-EQ",
            name="Reliance Industries",
            exchange=Exchange.NSE,
            instrument_type=InstrumentType.EQUITY,
            isin="INE002A01018",
            lot_size=1,
            tick_size=0.05,
            is_active=True,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_update_instrument():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        instrument = make_mock_instrument()
        instrument_id = instrument.id

        mock_service = MagicMock()
        mock_service.get_instrument.return_value = instrument
        mock_service.update_instrument.return_value = instrument

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.patch(
            f"/instruments/{instrument_id}",
            json={
                "name": "Updated Reliance Industries",
                "is_active": False,
            },
        )

        assert response.status_code == 200

        mock_service.get_instrument.assert_called_once_with(
            instrument_id=instrument_id,
        )

        mock_service.update_instrument.assert_called_once_with(
            instrument=instrument,
            symbol=None,
            trading_symbol=None,
            name="Updated Reliance Industries",
            exchange=None,
            instrument_type=None,
            isin=None,
            lot_size=None,
            tick_size=None,
            is_active=False,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_update_instrument_not_found():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        mock_service.get_instrument.return_value = None

        instrument_routes.InstrumentService = lambda db: mock_service

        instrument_id = uuid4()

        response = client.patch(
            f"/instruments/{instrument_id}",
            json={"is_active": False},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Instrument not found."

        mock_service.update_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service


def test_delete_instrument():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        instrument = make_mock_instrument()
        instrument_id = instrument.id

        mock_service = MagicMock()
        mock_service.get_instrument.return_value = instrument

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.delete(f"/instruments/{instrument_id}")

        assert response.status_code == 204
        assert response.content == b""

        mock_service.get_instrument.assert_called_once_with(
            instrument_id=instrument_id,
        )

        mock_service.delete_instrument.assert_called_once_with(
            instrument=instrument,
        )
    finally:
        instrument_routes.InstrumentService = original_service


def test_create_instrument_rejects_invalid_input():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service


def test_create_instrument_conflict():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        mock_service.create_instrument.side_effect = ValueError(
            "An instrument with this trading symbol already exists."
        )

        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 409
        assert (
            response.json()["detail"]
            == "An instrument with this trading symbol already exists."
        )
    finally:
        instrument_routes.InstrumentService = original_service

def test_create_instrument_rejects_blank_symbol():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "   ",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service


def test_create_instrument_rejects_blank_trading_symbol():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "   ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_update_instrument_rejects_blank_symbol():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.patch(
            f"/instruments/{uuid4()}",
            json={
                "symbol": "   ",
            },
        )

        assert response.status_code == 422
        mock_service.get_instrument.assert_not_called()
        mock_service.update_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service


def test_update_instrument_rejects_blank_trading_symbol():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.patch(
            f"/instruments/{uuid4()}",
            json={
                "trading_symbol": "   ",
            },
        )

        assert response.status_code == 422
        mock_service.get_instrument.assert_not_called()
        mock_service.update_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_create_instrument_rejects_blank_name():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "   ",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service


def test_update_instrument_rejects_blank_name():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.patch(
            f"/instruments/{uuid4()}",
            json={
                "name": "   ",
            },
        )

        assert response.status_code == 422
        mock_service.get_instrument.assert_not_called()
        mock_service.update_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_create_instrument_rejects_invalid_lot_size():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 0,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_create_instrument_rejects_invalid_tick_size():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_create_instrument_rejects_invalid_exchange():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "INVALID_EXCHANGE",
                "instrument_type": "EQUITY",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_create_instrument_rejects_invalid_instrument_type():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    try:
        mock_service = MagicMock()
        instrument_routes.InstrumentService = lambda db: mock_service

        response = client.post(
            "/instruments",
            json={
                "symbol": "RELIANCE",
                "trading_symbol": "RELIANCE-EQ",
                "name": "Reliance Industries",
                "exchange": "NSE",
                "instrument_type": "INVALID_TYPE",
                "lot_size": 1,
                "tick_size": 0.05,
            },
        )

        assert response.status_code == 422
        mock_service.create_instrument.assert_not_called()
    finally:
        instrument_routes.InstrumentService = original_service

def test_update_instrument_rejects_invalid_lot_size():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    class FakeService:
        def __init__(self, db):
            pass

        def update(self, instrument_id, **kwargs):
            raise AssertionError("Service should not be called")

    instrument_routes.InstrumentService = FakeService

    try:
        response = client.patch(
            f"/instruments/{uuid4()}",
            json={"lot_size": 0},
        )

        assert response.status_code == 422
    finally:
        instrument_routes.InstrumentService = original_service


def test_update_instrument_rejects_invalid_tick_size():
    import app.api.instruments.routes as instrument_routes

    original_service = instrument_routes.InstrumentService

    class FakeService:
        def __init__(self, db):
            pass

        def update(self, instrument_id, **kwargs):
            raise AssertionError("Service should not be called")

    instrument_routes.InstrumentService = FakeService

    try:
        response = client.patch(
            f"/instruments/{uuid4()}",
            json={"tick_size": 0},
        )

        assert response.status_code == 422
    finally:
        instrument_routes.InstrumentService = original_service