from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.models import User
from unittest.mock import MagicMock

client = TestClient(app)


def test_broker_api_loads():
    response = client.get("/")

    assert response.status_code == 200


def test_broker_accounts_requires_authentication():
    response = client.get("/brokers/accounts")

    assert response.status_code == 401


def test_broker_accounts_authenticated():
    test_user = User(
        id=uuid4(),
        email="api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        response = client.get("/brokers/accounts")

        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()

def test_create_broker_account():
    test_user = User(
        id=uuid4(),
        email="api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    mock_broker_account = MagicMock()
    mock_broker_account.id = uuid4()
    mock_broker_account.broker_name.value = "ZERODHA"
    mock_broker_account.broker_user_id = "TESTUSER001"
    mock_broker_account.account_alias = "Test Zerodha"
    mock_broker_account.connection_status.value = "DISCONNECTED"
    mock_broker_account.is_active = True
    mock_broker_account.last_synced_at = None
    mock_broker_account.created_at = MagicMock()
    mock_broker_account.created_at.isoformat.return_value = (
        "2026-09-02T00:00:00+00:00"
    )

    try:
        from app.api.brokers.routes import BrokerAccountService

        original_service = BrokerAccountService
        mock_service = MagicMock()
        mock_service.create_broker_account.return_value = mock_broker_account

        import app.api.brokers.routes as broker_routes

        broker_routes.BrokerAccountService = lambda db: mock_service

        response = client.post(
            "/brokers/accounts",
            json={
                "broker_name": "ZERODHA",
                "broker_user_id": "TESTUSER001",
                "account_alias": "Test Zerodha",
                "api_key": "test-api-key",
                "api_secret": "test-api-secret",
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["broker_name"] == "ZERODHA"
        assert data["broker_user_id"] == "TESTUSER001"
        assert data["account_alias"] == "Test Zerodha"
        assert data["connection_status"] == "DISCONNECTED"
        assert data["is_active"] is True

        assert "api_key" not in data
        assert "api_secret" not in data
        assert "access_token" not in data
        assert "refresh_token" not in data

    finally:
        broker_routes.BrokerAccountService = original_service
        app.dependency_overrides.clear()

def test_create_broker_account_rejects_duplicate():
    test_user = User(
        id=uuid4(),
        email="api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        from app.api.brokers.routes import BrokerAccountService
        import app.api.brokers.routes as broker_routes

        original_service = BrokerAccountService

        mock_service = MagicMock()
        mock_service.create_broker_account.side_effect = ValueError(
            "This broker account is already connected to your account."
        )

        broker_routes.BrokerAccountService = lambda db: mock_service

        response = client.post(
            "/brokers/accounts",
            json={
                "broker_name": "ZERODHA",
                "broker_user_id": "TESTUSER001",
                "account_alias": "Test Zerodha",
                "api_key": "test-api-key",
                "api_secret": "test-api-secret",
            },
        )

        assert response.status_code == 409
        assert response.json()["detail"] == (
            "This broker account is already connected to your account."
        )

    finally:
        broker_routes.BrokerAccountService = original_service
        app.dependency_overrides.clear()

def test_connect_broker_account():
    test_user = User(
        id=uuid4(),
        email="api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        from app.api.brokers.routes import BrokerAccountService
        import app.api.brokers.routes as broker_routes

        original_service = BrokerAccountService

        broker_account = MagicMock()
        broker_account.id = uuid4()
        broker_account.broker_name.value = "ZERODHA"
        broker_account.broker_user_id = "TESTUSER001"
        broker_account.account_alias = "Test Zerodha"
        broker_account.connection_status.value = "CONNECTED"
        broker_account.is_active = True
        broker_account.last_synced_at = None
        broker_account.created_at = MagicMock()
        broker_account.created_at.isoformat.return_value = (
            "2026-09-02T00:00:00+00:00"
        )

        mock_service = MagicMock()
        mock_service.get_broker_account.return_value = broker_account
        mock_service.connect_broker_account.return_value = broker_account

        broker_routes.BrokerAccountService = lambda db: mock_service

        response = client.post(
            f"/brokers/accounts/{broker_account.id}/connect",
            json={
                "access_token": "test-access-token",
                "refresh_token": "test-refresh-token",
            },
        )

        assert response.status_code == 200

        data = response.json()

        assert data["connection_status"] == "CONNECTED"
        assert data["broker_name"] == "ZERODHA"

        assert "access_token" not in data
        assert "refresh_token" not in data

        mock_service.connect_broker_account.assert_called_once_with(
            broker_account=broker_account,
            access_token="test-access-token",
            refresh_token="test-refresh-token",
        )

    finally:
        broker_routes.BrokerAccountService = original_service
        app.dependency_overrides.clear()

def test_disconnect_broker_account():
    test_user = User(
        id=uuid4(),
        email="api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        from app.api.brokers.routes import BrokerAccountService
        import app.api.brokers.routes as broker_routes

        original_service = BrokerAccountService

        broker_account = MagicMock()
        broker_account.id = uuid4()
        broker_account.broker_name.value = "ZERODHA"
        broker_account.broker_user_id = "TESTUSER001"
        broker_account.account_alias = "Test Zerodha"
        broker_account.connection_status.value = "DISCONNECTED"
        broker_account.is_active = True
        broker_account.last_synced_at = None
        broker_account.created_at = MagicMock()
        broker_account.created_at.isoformat.return_value = (
            "2026-09-02T00:00:00+00:00"
        )

        mock_service = MagicMock()
        mock_service.get_broker_account.return_value = broker_account
        mock_service.disconnect_broker_account.return_value = broker_account

        broker_routes.BrokerAccountService = lambda db: mock_service

        response = client.post(
            f"/brokers/accounts/{broker_account.id}/disconnect"
        )

        assert response.status_code == 200

        data = response.json()

        assert data["connection_status"] == "DISCONNECTED"
        assert data["broker_name"] == "ZERODHA"

        assert "access_token" not in data
        assert "refresh_token" not in data

        mock_service.disconnect_broker_account.assert_called_once_with(
            broker_account=broker_account,
        )

    finally:
        broker_routes.BrokerAccountService = original_service
        app.dependency_overrides.clear()