from unittest.mock import MagicMock
from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def make_mock_trade():
    trade = MagicMock()

    trade.id = uuid4()
    trade.order_id = uuid4()
    trade.broker_trade_id = "TRD-001"
    trade.executed_quantity = 25
    trade.executed_price = 251.50
    trade.brokerage = 10.00
    trade.total_charges = 12.50
    trade.trade_timestamp = None

    trade.created_at = MagicMock()
    trade.created_at.isoformat.return_value = "2026-09-28T00:00:00+00:00"

    trade.updated_at = MagicMock()
    trade.updated_at.isoformat.return_value = "2026-09-28T00:00:00+00:00"

    return trade


def test_create_trade():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        trade = make_mock_trade()

        mock_service = MagicMock()
        mock_service.create_trade.return_value = trade

        trade_routes.TradeService = lambda db: mock_service

        response = client.post(
            "/trades",
            json={
                "order_id": str(trade.order_id),
                "broker_trade_id": "TRD-001",
                "executed_quantity": 25,
                "executed_price": 251.50,
                "brokerage": 10.00,
                "total_charges": 12.50,
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["id"] == str(trade.id)
        assert data["order_id"] == str(trade.order_id)
        assert data["broker_trade_id"] == "TRD-001"
        assert data["executed_quantity"] == 25
        assert data["executed_price"] == 251.50

        mock_service.create_trade.assert_called_once_with(
            order_id=trade.order_id,
            broker_trade_id="TRD-001",
            executed_quantity=25,
            executed_price=251.50,
            brokerage=10.00,
            total_charges=12.50,
            trade_timestamp=None,
        )
    finally:
        trade_routes.TradeService = original_service


def test_list_trades():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        trade = make_mock_trade()

        mock_service = MagicMock()
        mock_service.list_trades.return_value = [trade]

        trade_routes.TradeService = lambda db: mock_service

        response = client.get("/trades")

        assert response.status_code == 200

        data = response.json()

        assert len(data) == 1
        assert data[0]["id"] == str(trade.id)

        mock_service.list_trades.assert_called_once_with()
    finally:
        trade_routes.TradeService = original_service


def test_get_trade():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        trade = make_mock_trade()
        trade_id = trade.id

        mock_service = MagicMock()
        mock_service.get_trade.return_value = trade

        trade_routes.TradeService = lambda db: mock_service

        response = client.get(f"/trades/{trade_id}")

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(trade_id)
        assert data["executed_quantity"] == 25

        mock_service.get_trade.assert_called_once_with(
            trade_id=trade_id,
        )
    finally:
        trade_routes.TradeService = original_service


def test_get_trade_not_found():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        mock_service = MagicMock()
        mock_service.get_trade.return_value = None

        trade_routes.TradeService = lambda db: mock_service

        trade_id = uuid4()

        response = client.get(f"/trades/{trade_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Trade not found."

        mock_service.get_trade.assert_called_once_with(
            trade_id=trade_id,
        )
    finally:
        trade_routes.TradeService = original_service


def test_update_trade():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        trade = make_mock_trade()
        trade_id = trade.id

        mock_service = MagicMock()
        mock_service.get_trade.return_value = trade
        mock_service.update_trade.return_value = trade

        trade_routes.TradeService = lambda db: mock_service

        response = client.patch(
            f"/trades/{trade_id}",
            json={
                "broker_trade_id": "TRD-002",
                "executed_quantity": 30,
                "executed_price": 252.00,
                "brokerage": 11.00,
                "total_charges": 13.50,
            },
        )

        assert response.status_code == 200

        mock_service.get_trade.assert_called_once_with(
            trade_id=trade_id,
        )

        mock_service.update_trade.assert_called_once_with(
            trade=trade,
            broker_trade_id="TRD-002",
            executed_quantity=30,
            executed_price=252.00,
            brokerage=11.00,
            total_charges=13.50,
            trade_timestamp=None,
        )
    finally:
        trade_routes.TradeService = original_service


def test_update_trade_not_found():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        mock_service = MagicMock()
        mock_service.get_trade.return_value = None

        trade_routes.TradeService = lambda db: mock_service

        trade_id = uuid4()

        response = client.patch(
            f"/trades/{trade_id}",
            json={
                "executed_quantity": 30,
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Trade not found."

        mock_service.update_trade.assert_not_called()
    finally:
        trade_routes.TradeService = original_service


def test_delete_trade():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        trade = make_mock_trade()
        trade_id = trade.id

        mock_service = MagicMock()
        mock_service.get_trade.return_value = trade

        trade_routes.TradeService = lambda db: mock_service

        response = client.delete(f"/trades/{trade_id}")

        assert response.status_code == 204
        assert response.content == b""

        mock_service.get_trade.assert_called_once_with(
            trade_id=trade_id,
        )

        mock_service.delete_trade.assert_called_once_with(
            trade=trade,
        )
    finally:
        trade_routes.TradeService = original_service


def test_delete_trade_not_found():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        mock_service = MagicMock()
        mock_service.get_trade.return_value = None

        trade_routes.TradeService = lambda db: mock_service

        trade_id = uuid4()

        response = client.delete(f"/trades/{trade_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Trade not found."

        mock_service.delete_trade.assert_not_called()
    finally:
        trade_routes.TradeService = original_service


def test_create_trade_rejects_invalid_input():
    import app.api.trades.routes as trade_routes

    original_service = trade_routes.TradeService

    try:
        mock_service = MagicMock()
        trade_routes.TradeService = lambda db: mock_service

        response = client.post(
            "/trades",
            json={
                "order_id": "not-a-uuid",
                "broker_trade_id": "TRD-001",
                "executed_quantity": 25,
                "executed_price": 251.50,
                "brokerage": 10.00,
                "total_charges": 12.50,
            },
        )

        assert response.status_code == 422
        mock_service.create_trade.assert_not_called()
    finally:
        trade_routes.TradeService = original_service

def test_create_trade_rejects_nonpositive_executed_quantity():
    response = client.post(
        "/trades",
        json={
            "order_id": str(uuid4()),
            "executed_quantity": 0,
            "executed_price": 251.50,
            "brokerage": 10.00,
            "total_charges": 12.50,
        },
    )

    assert response.status_code == 422


def test_create_trade_rejects_nonpositive_executed_price():
    response = client.post(
        "/trades",
        json={
            "order_id": str(uuid4()),
            "executed_quantity": 25,
            "executed_price": 0,
            "brokerage": 10.00,
            "total_charges": 12.50,
        },
    )

    assert response.status_code == 422


def test_create_trade_rejects_negative_brokerage():
    response = client.post(
        "/trades",
        json={
            "order_id": str(uuid4()),
            "executed_quantity": 25,
            "executed_price": 251.50,
            "brokerage": -1.00,
            "total_charges": 12.50,
        },
    )

    assert response.status_code == 422


def test_create_trade_rejects_negative_total_charges():
    response = client.post(
        "/trades",
        json={
            "order_id": str(uuid4()),
            "executed_quantity": 25,
            "executed_price": 251.50,
            "brokerage": 10.00,
            "total_charges": -1.00,
        },
    )

    assert response.status_code == 422

def test_execute_trade():
    import app.api.trades.routes as trade_routes

    order_id = uuid4()

    trade = MagicMock()
    trade.id = uuid4()
    trade.order_id = order_id
    trade.broker_trade_id = "EXEC-001"
    trade.executed_quantity = 25
    trade.executed_price = 250.50
    trade.brokerage = 5.00
    trade.total_charges = 6.00
    trade.trade_timestamp = datetime.now(timezone.utc)
    trade.created_at = datetime.now(timezone.utc)
    trade.updated_at = datetime.now(timezone.utc)

    mock_service = MagicMock()
    mock_service.execute_trade.return_value = trade

    original_service = trade_routes.TradeService
    trade_routes.TradeService = lambda db: mock_service

    try:
        response = client.post(
            "/trades/execute",
            json={
                "order_id": str(order_id),
                "broker_trade_id": "EXEC-001",
                "executed_quantity": 25,
                "executed_price": 250.50,
                "brokerage": 5.00,
                "total_charges": 6.00,
                "trade_timestamp": trade.trade_timestamp.isoformat(),
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["id"] == str(trade.id)
        assert data["order_id"] == str(order_id)
        assert data["broker_trade_id"] == "EXEC-001"
        assert data["executed_quantity"] == 25
        assert data["executed_price"] == 250.50

        mock_service.execute_trade.assert_called_once_with(
            order_id=order_id,
            broker_trade_id="EXEC-001",
            executed_quantity=25,
            executed_price=250.50,
            brokerage=5.00,
            total_charges=6.00,
            trade_timestamp=trade.trade_timestamp,
        )
    finally:
        trade_routes.TradeService = original_service
