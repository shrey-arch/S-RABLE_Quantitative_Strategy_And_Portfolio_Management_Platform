from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def make_mock_position():
    position = MagicMock()

    position.id = uuid4()
    position.execution_id = uuid4()
    position.instrument_id = uuid4()
    position.broker_account_id = uuid4()
    position.quantity = 100
    position.average_price = 250.50
    position.current_price = 255.00
    position.market_value = 25500.00
    position.realized_pnl = 0.00
    position.unrealized_pnl = 450.00
    position.position_status = "OPEN"
    position.last_updated_at = datetime.now(timezone.utc)
    position.closed_at = None

    position.created_at = MagicMock()
    position.created_at.isoformat.return_value = "2026-09-28T00:00:00+00:00"

    position.updated_at = MagicMock()
    position.updated_at.isoformat.return_value = "2026-09-28T00:00:00+00:00"

    return position


def test_create_position():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        position = make_mock_position()

        mock_service = MagicMock()
        mock_service.create_position.return_value = position

        position_routes.PositionService = lambda db: mock_service

        response = client.post(
            "/positions",
            json={
                "execution_id": str(position.execution_id),
                "instrument_id": str(position.instrument_id),
                "broker_account_id": str(position.broker_account_id),
                "quantity": 100,
                "average_price": 250.50,
                "current_price": 255.00,
                "market_value": 25500.00,
                "realized_pnl": 0.00,
                "unrealized_pnl": 450.00,
                "position_status": "OPEN",
                "last_updated_at": position.last_updated_at.isoformat(),
                "closed_at": None,
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["id"] == str(position.id)
        assert data["execution_id"] == str(position.execution_id)
        assert data["instrument_id"] == str(position.instrument_id)
        assert data["quantity"] == 100
        assert data["average_price"] == 250.50
        assert data["position_status"] == "OPEN"

        mock_service.create_position.assert_called_once()

    finally:
        position_routes.PositionService = original_service


def test_list_positions():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        first_position = make_mock_position()
        second_position = make_mock_position()

        mock_service = MagicMock()
        mock_service.list_positions.return_value = [
            first_position,
            second_position,
        ]

        position_routes.PositionService = lambda db: mock_service

        response = client.get("/positions")

        assert response.status_code == 200

        data = response.json()

        assert len(data) == 2
        assert data[0]["id"] == str(first_position.id)
        assert data[1]["id"] == str(second_position.id)

        mock_service.list_positions.assert_called_once()

    finally:
        position_routes.PositionService = original_service


def test_get_position():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        position = make_mock_position()

        mock_service = MagicMock()
        mock_service.get_position.return_value = position

        position_routes.PositionService = lambda db: mock_service

        response = client.get(
            f"/positions/{position.id}",
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(position.id)
        assert data["quantity"] == 100

        mock_service.get_position.assert_called_once_with(
            position_id=position.id,
        )

    finally:
        position_routes.PositionService = original_service


def test_get_position_not_found():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        mock_service = MagicMock()
        mock_service.get_position.return_value = None

        position_routes.PositionService = lambda db: mock_service

        response = client.get(
            f"/positions/{uuid4()}",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Position not found."

    finally:
        position_routes.PositionService = original_service


def test_update_position():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        position = make_mock_position()

        mock_service = MagicMock()
        mock_service.get_position.return_value = position
        mock_service.update_position.return_value = position

        position_routes.PositionService = lambda db: mock_service

        response = client.patch(
            f"/positions/{position.id}",
            json={
                "quantity": 150,
                "average_price": 252.00,
                "current_price": 260.00,
                "market_value": 39000.00,
                "realized_pnl": 500.00,
                "unrealized_pnl": 1200.00,
                "position_status": "CLOSED",
                "last_updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(position.id)

        mock_service.update_position.assert_called_once()

    finally:
        position_routes.PositionService = original_service


def test_update_position_not_found():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        mock_service = MagicMock()
        mock_service.get_position.return_value = None

        position_routes.PositionService = lambda db: mock_service

        response = client.patch(
            f"/positions/{uuid4()}",
            json={
                "quantity": 150,
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Position not found."

    finally:
        position_routes.PositionService = original_service


def test_delete_position():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        position = make_mock_position()

        mock_service = MagicMock()
        mock_service.get_position.return_value = position
        mock_service.delete_position.return_value = None

        position_routes.PositionService = lambda db: mock_service

        response = client.delete(
            f"/positions/{position.id}",
        )

        assert response.status_code == 204

        mock_service.delete_position.assert_called_once_with(
            position=position,
        )

    finally:
        position_routes.PositionService = original_service


def test_delete_position_not_found():
    import app.api.positions.routes as position_routes

    original_service = position_routes.PositionService

    try:
        mock_service = MagicMock()
        mock_service.get_position.return_value = None

        position_routes.PositionService = lambda db: mock_service

        response = client.delete(
            f"/positions/{uuid4()}",
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Position not found."

    finally:
        position_routes.PositionService = original_service

def test_create_position_rejects_zero_quantity():
    data = {
        "execution_id": str(uuid4()),
        "instrument_id": str(uuid4()),
        "quantity": 0,
        "average_price": 250.00,
        "current_price": 255.00,
        "market_value": 25500.00,
        "realized_pnl": 0.00,
        "unrealized_pnl": 500.00,
        "position_status": "OPEN",
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
    }

    response = client.post("/positions", json=data)

    assert response.status_code == 422


def test_create_position_rejects_zero_average_price():
    data = {
        "execution_id": str(uuid4()),
        "instrument_id": str(uuid4()),
        "quantity": 100,
        "average_price": 0,
        "current_price": 255.00,
        "market_value": 25500.00,
        "realized_pnl": 0.00,
        "unrealized_pnl": 500.00,
        "position_status": "OPEN",
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
    }

    response = client.post("/positions", json=data)

    assert response.status_code == 422


def test_create_position_rejects_zero_current_price():
    data = {
        "execution_id": str(uuid4()),
        "instrument_id": str(uuid4()),
        "quantity": 100,
        "average_price": 250.00,
        "current_price": 0,
        "market_value": 25500.00,
        "realized_pnl": 0.00,
        "unrealized_pnl": 500.00,
        "position_status": "OPEN",
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
    }

    response = client.post("/positions", json=data)

    assert response.status_code == 422


def test_create_position_rejects_negative_market_value():
    data = {
        "execution_id": str(uuid4()),
        "instrument_id": str(uuid4()),
        "quantity": 100,
        "average_price": 250.00,
        "current_price": 255.00,
        "market_value": -1.00,
        "realized_pnl": 0.00,
        "unrealized_pnl": 500.00,
        "position_status": "OPEN",
        "last_updated_at": datetime.now(timezone.utc).isoformat(),
    }

    response = client.post("/positions", json=data)

    assert response.status_code == 422
