from unittest.mock import MagicMock
from uuid import uuid4
from app.enums import ConnectionStatus

from app.models import BrokerAccount
from app.repositories.brokers.broker_account_repository import (
    BrokerAccountRepository,
)


def test_create_for_user():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    user_id = uuid4()

    broker_account = repository.create_for_user(
        user_id=user_id,
        broker_name="ZERODHA",
        broker_user_id="TESTUSER001",
        account_alias="Test Zerodha",
        api_key="test-api-key",
        api_secret="test-api-secret",
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(broker_account)

    assert broker_account.user_id == user_id
    assert broker_account.broker_user_id == "TESTUSER001"
    assert broker_account.account_alias == "Test Zerodha"


def test_list_for_user():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    first_account = MagicMock(spec=BrokerAccount)
    second_account = MagicMock(spec=BrokerAccount)

    db.scalars.return_value.all.return_value = [
        first_account,
        second_account,
    ]

    accounts = repository.list_for_user(
        user_id=uuid4(),
    )

    assert accounts == [
        first_account,
        second_account,
    ]

    db.scalars.assert_called_once()


def test_get_by_id_for_user():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    broker_account = MagicMock(spec=BrokerAccount)
    db.scalar.return_value = broker_account

    broker_account_id = uuid4()
    user_id = uuid4()

    result = repository.get_by_id_for_user(
        broker_account_id=broker_account_id,
        user_id=user_id,
    )

    assert result == broker_account
    db.scalar.assert_called_once()


def test_update_for_user():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    broker_account = MagicMock(spec=BrokerAccount)

    result = repository.update_for_user(
        broker_account=broker_account,
        account_alias="Updated Zerodha",
        is_active=False,
    )

    assert result == broker_account
    assert broker_account.account_alias == "Updated Zerodha"
    assert broker_account.is_active is False

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(broker_account)


def test_delete_for_user():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    broker_account = MagicMock(spec=BrokerAccount)

    result = repository.delete_for_user(
        broker_account=broker_account,
    )

    assert result is None
    db.delete.assert_called_once_with(broker_account)
    db.commit.assert_called_once()

def test_connect_account():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    broker_account = MagicMock(spec=BrokerAccount)

    result = repository.connect_account(
        broker_account=broker_account,
        access_token="test-access-token",
        refresh_token="test-refresh-token",
    )

    assert result == broker_account
    assert broker_account.access_token == "test-access-token"
    assert broker_account.refresh_token == "test-refresh-token"
    assert broker_account.connection_status == ConnectionStatus.CONNECTED

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(broker_account)

def test_disconnect_account():
    db = MagicMock()
    repository = BrokerAccountRepository(db)

    broker_account = MagicMock(spec=BrokerAccount)
    broker_account.access_token = "test-access-token"
    broker_account.refresh_token = "test-refresh-token"

    result = repository.disconnect_account(
        broker_account=broker_account,
    )

    assert result == broker_account
    assert broker_account.access_token is None
    assert broker_account.refresh_token is None
    assert broker_account.connection_status == ConnectionStatus.DISCONNECTED

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(broker_account)