from unittest.mock import MagicMock
from uuid import uuid4

from app.enums import ExecutionStatus, ExecutionType
from app.models import Execution
from app.repositories.executions.execution_repository import (
    ExecutionRepository,
)


def test_create():
    db = MagicMock()
    repository = ExecutionRepository(db)

    strategy_id = uuid4()
    broker_account_id = uuid4()
    instrument_id = uuid4()

    execution = repository.create(
        strategy_id=strategy_id,
        broker_account_id=broker_account_id,
        instrument_id=instrument_id,
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        timeframe="1D",
        initial_capital=100000,
        execution_config={"lookback": 100},
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(execution)

    assert execution.strategy_id == strategy_id
    assert execution.broker_account_id == broker_account_id
    assert execution.instrument_id == instrument_id
    assert execution.execution_type == ExecutionType.BACKTEST
    assert execution.status == ExecutionStatus.PENDING
    assert execution.timeframe == "1D"
    assert execution.initial_capital == 100000
    assert execution.execution_config == {"lookback": 100}


def test_list():
    db = MagicMock()
    repository = ExecutionRepository(db)

    first_execution = MagicMock(spec=Execution)
    second_execution = MagicMock(spec=Execution)

    db.scalars.return_value.all.return_value = [
        first_execution,
        second_execution,
    ]

    executions = repository.list()

    assert executions == [
        first_execution,
        second_execution,
    ]

    db.scalars.assert_called_once()


def test_get_by_id():
    db = MagicMock()
    repository = ExecutionRepository(db)

    execution = MagicMock(spec=Execution)
    db.scalar.return_value = execution

    execution_id = uuid4()

    result = repository.get_by_id(
        execution_id=execution_id,
    )

    assert result == execution
    db.scalar.assert_called_once()


def test_update():
    db = MagicMock()
    repository = ExecutionRepository(db)

    execution = MagicMock(spec=Execution)

    result = repository.update(
        execution=execution,
        execution_config={"lookback": 200},
    )

    assert result == execution
    assert execution.execution_config == {"lookback": 200}

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(execution)


def test_delete():
    db = MagicMock()
    repository = ExecutionRepository(db)

    execution = MagicMock(spec=Execution)

    result = repository.delete(
        execution=execution,
    )

    assert result is None
    db.delete.assert_called_once_with(execution)
    db.commit.assert_called_once()