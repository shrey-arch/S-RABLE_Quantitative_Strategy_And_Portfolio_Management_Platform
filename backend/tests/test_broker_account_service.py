from unittest.mock import MagicMock
import pytest
from uuid import uuid4

from app.models import BrokerAccount
from app.services.brokers.broker_account_service import BrokerAccountService


def test_create_broker_account():
    db = MagicMock()
    service = BrokerAccountService(db)
    service.repository.get_by_broker_identity = MagicMock(return_value=None)

    broker_account = MagicMock(spec=BrokerAccount)
    service.repository.create_for_user = MagicMock(
        return_value=broker_account
    )

    user_id = uuid4()

    result = service.create_broker_account(
        user_id=user_id,
        broker_name="ZERODHA",
        broker_user_id="TESTUSER001",
        account_alias="Test Zerodha",
        api_key="test-api-key",
        api_secret="test-api-secret",
    )

    assert result == broker_account

    service.repository.create_for_user.assert_called_once_with(
        user_id=user_id,
        broker_name="ZERODHA",
        broker_user_id="TESTUSER001",
        account_alias="Test Zerodha",
        api_key="test-api-key",
        api_secret="test-api-secret",
    )


def test_list_broker_accounts():
    db = MagicMock()
    service = BrokerAccountService(db)

    accounts = [
        MagicMock(spec=BrokerAccount),
        MagicMock(spec=BrokerAccount),
    ]

    service.repository.list_for_user = MagicMock(
        return_value=accounts
    )

    user_id = uuid4()

    result = service.list_broker_accounts(
        user_id=user_id,
    )

    assert result == accounts

    service.repository.list_for_user.assert_called_once_with(
        user_id=user_id,
    )


def test_get_broker_account():
    db = MagicMock()
    service = BrokerAccountService(db)

    broker_account = MagicMock(spec=BrokerAccount)

    service.repository.get_by_id_for_user = MagicMock(
        return_value=broker_account
    )

    broker_account_id = uuid4()
    user_id = uuid4()

    result = service.get_broker_account(
        broker_account_id=broker_account_id,
        user_id=user_id,
    )

    assert result == broker_account

    service.repository.get_by_id_for_user.assert_called_once_with(
        broker_account_id=broker_account_id,
        user_id=user_id,
    )


def test_update_broker_account():
    db = MagicMock()
    service = BrokerAccountService(db)

    broker_account = MagicMock(spec=BrokerAccount)

    service.repository.update_for_user = MagicMock(
        return_value=broker_account
    )

    result = service.update_broker_account(
        broker_account=broker_account,
        account_alias="Updated Zerodha",
        is_active=False,
    )

    assert result == broker_account

    service.repository.update_for_user.assert_called_once_with(
        broker_account=broker_account,
        account_alias="Updated Zerodha",
        is_active=False,
    )


def test_delete_broker_account():
    db = MagicMock()
    service = BrokerAccountService(db)

    broker_account = MagicMock(spec=BrokerAccount)

    service.repository.delete_for_user = MagicMock(
        return_value=None
    )

    result = service.delete_broker_account(
        broker_account=broker_account,
    )

    assert result is None

    service.repository.delete_for_user.assert_called_once_with(
        broker_account=broker_account,
    )

def test_create_broker_account_rejects_duplicate():
    db = MagicMock()
    service = BrokerAccountService(db)

    existing_account = MagicMock(spec=BrokerAccount)

    service.repository.get_by_broker_identity = MagicMock(
        return_value=existing_account
    )
    service.repository.create_for_user = MagicMock()

    user_id = uuid4()

    with pytest.raises(
        ValueError,
        match="already connected",
    ):
        service.create_broker_account(
            user_id=user_id,
            broker_name="ZERODHA",
            broker_user_id="TESTUSER001",
            account_alias="Test Zerodha",
            api_key="test-api-key",
            api_secret="test-api-secret",
        )

    service.repository.create_for_user.assert_not_called()

def test_connect_broker_account():
    db = MagicMock()
    service = BrokerAccountService(db)

    broker_account = MagicMock(spec=BrokerAccount)

    service.repository.connect_account = MagicMock(
        return_value=broker_account
    )

    result = service.connect_broker_account(
        broker_account=broker_account,
        access_token="test-access-token",
        refresh_token="test-refresh-token",
    )

    assert result == broker_account

    service.repository.connect_account.assert_called_once_with(
        broker_account=broker_account,
        access_token="test-access-token",
        refresh_token="test-refresh-token",
    )

def test_disconnect_broker_account():
    db = MagicMock()
    service = BrokerAccountService(db)

    broker_account = MagicMock(spec=BrokerAccount)

    service.repository.disconnect_account = MagicMock(
        return_value=broker_account
    )

    result = service.disconnect_broker_account(
        broker_account=broker_account,
    )

    assert result == broker_account

    service.repository.disconnect_account.assert_called_once_with(
        broker_account=broker_account,
    )
