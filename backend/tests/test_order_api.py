from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

from app.enums import OrderSide, OrderStatus, OrderType
from app.main import app


client = TestClient(app)


def make_mock_order():
    order = MagicMock()

    order.id = uuid4()
    order.execution_id = uuid4()
    order.instrument_id = uuid4()
    order.broker_order_id = "BRK-001"
    order.order_type = OrderType.MARKET
    order.order_side = OrderSide.BUY
    order.status = OrderStatus.PENDING
    order.quantity = 100
    order.filled_quantity = 0
    order.price = 250.50
    order.average_fill_price = None
    order.order_timestamp = None

    order.created_at = MagicMock()
    order.created_at.isoformat.return_value = "2026-09-28T00:00:00+00:00"

    order.updated_at = MagicMock()
    order.updated_at.isoformat.return_value = "2026-09-28T00:00:00+00:00"

    return order


def test_create_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()

        mock_service = MagicMock()
        mock_service.create_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.post(
            "/orders",
            json={
                "execution_id": str(order.execution_id),
                "instrument_id": str(order.instrument_id),
                "broker_order_id": "BRK-001",
                "order_type": "MARKET",
                "order_side": "BUY",
                "status": "PENDING",
                "quantity": 100,
                "filled_quantity": 0,
                "price": 250.50,
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["id"] == str(order.id)
        assert data["execution_id"] == str(order.execution_id)
        assert data["instrument_id"] == str(order.instrument_id)
        assert data["status"] == "PENDING"

        mock_service.create_order.assert_called_once_with(
            execution_id=order.execution_id,
            instrument_id=order.instrument_id,
            broker_order_id="BRK-001",
            order_type=OrderType.MARKET,
            order_side=OrderSide.BUY,
            status=OrderStatus.PENDING,
            quantity=100,
            filled_quantity=0,
            price=250.50,
            average_fill_price=None,
            order_timestamp=None,
        )
    finally:
        order_routes.OrderService = original_service


def test_list_orders():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()

        mock_service = MagicMock()
        mock_service.list_orders.return_value = [order]

        order_routes.OrderService = lambda db: mock_service

        response = client.get("/orders")

        assert response.status_code == 200

        data = response.json()

        assert len(data) == 1
        assert data[0]["id"] == str(order.id)

        mock_service.list_orders.assert_called_once_with()
    finally:
        order_routes.OrderService = original_service


def test_get_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.get(f"/orders/{order_id}")

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(order_id)
        assert data["quantity"] == 100

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )
    finally:
        order_routes.OrderService = original_service


def test_get_order_not_found():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        mock_service = MagicMock()
        mock_service.get_order.return_value = None

        order_routes.OrderService = lambda db: mock_service

        order_id = uuid4()

        response = client.get(f"/orders/{order_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found."

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )
    finally:
        order_routes.OrderService = original_service


def test_update_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.update_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.patch(
            f"/orders/{order_id}",
            json={
                "broker_order_id": "BRK-002",
                "filled_quantity": 25,
                "average_fill_price": 251.00,
            },
        )

        assert response.status_code == 200

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.update_order.assert_called_once_with(
            order=order,
            broker_order_id="BRK-002",
            filled_quantity=25,
            average_fill_price=251.00,
            order_timestamp=None,
        )
    finally:
        order_routes.OrderService = original_service

def test_update_order_not_found():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        mock_service = MagicMock()
        mock_service.get_order.return_value = None

        order_routes.OrderService = lambda db: mock_service

        order_id = uuid4()

        response = client.patch(
            f"/orders/{order_id}",
            json={
                "status": "OPEN",
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found."

        mock_service.update_order.assert_not_called()
    finally:
        order_routes.OrderService = original_service


def test_delete_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.delete(f"/orders/{order_id}")

        assert response.status_code == 204
        assert response.content == b""

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.delete_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service


def test_delete_order_not_found():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        mock_service = MagicMock()
        mock_service.get_order.return_value = None

        order_routes.OrderService = lambda db: mock_service

        order_id = uuid4()

        response = client.delete(f"/orders/{order_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Order not found."

        mock_service.delete_order.assert_not_called()
    finally:
        order_routes.OrderService = original_service


def test_create_order_rejects_invalid_input():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        mock_service = MagicMock()
        order_routes.OrderService = lambda db: mock_service

        response = client.post(
            "/orders",
            json={
                "execution_id": "not-a-uuid",
                "instrument_id": str(uuid4()),
                "order_type": "MARKET",
                "order_side": "BUY",
                "status": "PENDING",
                "quantity": 100,
                "filled_quantity": 0,
                "price": 250.50,
            },
        )

        assert response.status_code == 422
        mock_service.create_order.assert_not_called()
    finally:
        order_routes.OrderService = original_service

def test_open_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.open_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/open")

        assert response.status_code == 200

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.open_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service


def test_open_order_invalid_transition():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.open_order.side_effect = ValueError(
            "Invalid order transition: COMPLETED -> OPEN."
        )

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/open")

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Invalid order transition: COMPLETED -> OPEN."
        )

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.open_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service

def test_complete_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.complete_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/complete")

        assert response.status_code == 200

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.complete_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service


def test_complete_order_invalid_transition():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.complete_order.side_effect = ValueError(
            "Invalid order transition: PENDING -> COMPLETED."
        )

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/complete")

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Invalid order transition: PENDING -> COMPLETED."
        )

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.complete_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service

def test_cancel_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.cancel_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/cancel")

        assert response.status_code == 200

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.cancel_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service


def test_cancel_order_invalid_transition():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.cancel_order.side_effect = ValueError(
            "Invalid order transition: COMPLETED -> CANCELLED."
        )

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/cancel")

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Invalid order transition: COMPLETED -> CANCELLED."
        )

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.cancel_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service

def test_reject_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.reject_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/reject")

        assert response.status_code == 200

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.reject_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service


def test_reject_order_invalid_transition():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.reject_order.side_effect = ValueError(
            "Invalid order transition: PENDING -> REJECTED."
        )

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/reject")

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Invalid order transition: PENDING -> REJECTED."
        )

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.reject_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service

def test_reject_order():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.reject_order.return_value = order

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/reject")

        assert response.status_code == 200

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.reject_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service


def test_reject_order_invalid_transition():
    import app.api.orders.routes as order_routes

    original_service = order_routes.OrderService

    try:
        order = make_mock_order()
        order_id = order.id

        mock_service = MagicMock()
        mock_service.get_order.return_value = order
        mock_service.reject_order.side_effect = ValueError(
            "Invalid order transition: PENDING -> REJECTED."
        )

        order_routes.OrderService = lambda db: mock_service

        response = client.post(f"/orders/{order_id}/reject")

        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Invalid order transition: PENDING -> REJECTED."
        )

        mock_service.get_order.assert_called_once_with(
            order_id=order_id,
        )

        mock_service.reject_order.assert_called_once_with(
            order=order,
        )
    finally:
        order_routes.OrderService = original_service
