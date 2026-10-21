from uuid import uuid4
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.models import User
import app.api.brokers.routes as broker_routes


client = TestClient(app)


def make_broker_account():
    account = MagicMock()
    account.id = uuid4()
    account.broker_name.value = "ZERODHA"
    account.broker_user_id = "TESTUSER001"
    account.account_alias = "Test Zerodha"
    account.connection_status.value = "DISCONNECTED"
    account.is_active = True
    account.last_synced_at = None
    account.created_at.isoformat.return_value = "2026-09-02T00:00:00+00:00"
    return account


def run_authenticated(monkeypatch, service, request):
    user = User(id=uuid4(), email="broker-detail-test@example.com")
    monkeypatch.setattr(broker_routes, "BrokerAccountService", lambda db: service)
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        return request()
    finally:
        app.dependency_overrides.clear()


def test_get_broker_account_returns_account(monkeypatch):
    account = make_broker_account()
    service = MagicMock()
    service.get_broker_account.return_value = account

    response = run_authenticated(
        monkeypatch,
        service,
        lambda: client.get(f"/brokers/accounts/{account.id}"),
    )

    assert response.status_code == 200
    assert response.json()["id"] == str(account.id)
    assert response.json()["broker_name"] == "ZERODHA"
    service.get_broker_account.assert_called_once_with(
        broker_account_id=account.id,
        user_id=service.get_broker_account.call_args.kwargs["user_id"],
    )


def test_get_broker_account_missing_returns_404(monkeypatch):
    service = MagicMock()
    service.get_broker_account.return_value = None
    account_id = uuid4()

    response = run_authenticated(
        monkeypatch,
        service,
        lambda: client.get(f"/brokers/accounts/{account_id}"),
    )

    assert response.status_code == 404


def test_update_broker_account_returns_updated_account(monkeypatch):
    account = make_broker_account()
    account.account_alias = "Updated Alias"
    account.is_active = False

    service = MagicMock()
    service.get_broker_account.return_value = account
    service.update_broker_account.return_value = account

    response = run_authenticated(
        monkeypatch,
        service,
        lambda: client.patch(
            f"/brokers/accounts/{account.id}",
            json={"account_alias": "Updated Alias", "is_active": False},
        ),
    )

    assert response.status_code == 200
    assert response.json()["account_alias"] == "Updated Alias"
    assert response.json()["is_active"] is False
    service.update_broker_account.assert_called_once_with(
        broker_account=account,
        account_alias="Updated Alias",
        is_active=False,
    )


def test_update_broker_account_missing_returns_404(monkeypatch):
    service = MagicMock()
    service.get_broker_account.return_value = None
    account_id = uuid4()

    response = run_authenticated(
        monkeypatch,
        service,
        lambda: client.patch(
            f"/brokers/accounts/{account_id}",
            json={"account_alias": "Updated Alias"},
        ),
    )

    assert response.status_code == 404


def test_delete_broker_account_returns_204(monkeypatch):
    account = make_broker_account()
    service = MagicMock()
    service.get_broker_account.return_value = account

    response = run_authenticated(
        monkeypatch,
        service,
        lambda: client.delete(f"/brokers/accounts/{account.id}"),
    )

    assert response.status_code == 204
    service.delete_broker_account.assert_called_once_with(
        broker_account=account,
    )


def test_delete_broker_account_missing_returns_404(monkeypatch):
    service = MagicMock()
    service.get_broker_account.return_value = None
    account_id = uuid4()

    response = run_authenticated(
        monkeypatch,
        service,
        lambda: client.delete(f"/brokers/accounts/{account_id}"),
    )

    assert response.status_code == 404


def test_broker_account_detail_requires_authentication():
    response = client.get(f"/brokers/accounts/{uuid4()}")
    assert response.status_code == 401
