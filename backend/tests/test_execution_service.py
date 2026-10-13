from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.enums import ExecutionStatus, ExecutionType
from app.models import Execution
from app.services.executions.execution_service import ExecutionService


def test_create_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock(spec=Execution)
    service.repository.create = MagicMock(return_value=execution)

    strategy_id = uuid4()
    broker_account_id = uuid4()
    instrument_id = uuid4()

    result = service.create_execution(
        strategy_id=strategy_id,
        broker_account_id=broker_account_id,
        instrument_id=instrument_id,
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        timeframe="1D",
        initial_capital=100000,
        execution_config={"lookback": 100},
    )

    assert result == execution

    service.repository.create.assert_called_once_with(
        strategy_id=strategy_id,
        broker_account_id=broker_account_id,
        instrument_id=instrument_id,
        execution_type=ExecutionType.BACKTEST,
        status=ExecutionStatus.PENDING,
        timeframe="1D",
        initial_capital=100000,
        execution_config={"lookback": 100},
    )


def test_list_executions():
    db = MagicMock()
    service = ExecutionService(db)

    executions = [
        MagicMock(spec=Execution),
        MagicMock(spec=Execution),
    ]

    service.repository.list = MagicMock(return_value=executions)

    result = service.list_executions()

    assert result == executions
    service.repository.list.assert_called_once_with()


def test_get_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock(spec=Execution)
    service.repository.get_by_id = MagicMock(return_value=execution)

    execution_id = uuid4()

    result = service.get_execution(
        execution_id=execution_id,
    )

    assert result == execution

    service.repository.get_by_id.assert_called_once_with(
        execution_id=execution_id,
    )


def test_get_required_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock(spec=Execution)
    service.repository.get_by_id = MagicMock(return_value=execution)

    execution_id = uuid4()

    result = service.get_required_execution(
        execution_id=execution_id,
    )

    assert result is execution

    service.repository.get_by_id.assert_called_once_with(
        execution_id=execution_id,
    )


def test_get_required_execution_not_found():
    db = MagicMock()
    service = ExecutionService(db)

    service.repository.get_by_id = MagicMock(return_value=None)

    execution_id = uuid4()

    with pytest.raises(ValueError, match="Execution not found\\."):
        service.get_required_execution(
            execution_id=execution_id,
        )


def test_update_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock(spec=Execution)
    service.repository.update = MagicMock(return_value=execution)

    result = service.update_execution(
        execution=execution,
        execution_config={"lookback": 200},
    )

    assert result == execution

    service.repository.update.assert_called_once_with(
        execution=execution,
        execution_config={"lookback": 200},
    )


def test_delete_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock(spec=Execution)
    service.repository.delete = MagicMock(return_value=None)

    result = service.delete_execution(
        execution=execution,
    )

    assert result is None

    service.repository.delete.assert_called_once_with(
        execution=execution,
    )

def test_transition_execution():
    from unittest.mock import MagicMock

    from app.enums import ExecutionStatus
    from app.services.executions.execution_service import ExecutionService

    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.PENDING

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.transition_execution(
        execution=execution,
        target_status=ExecutionStatus.RUNNING,
    )

    assert execution.status == ExecutionStatus.RUNNING
    assert result == execution

    service.repository.update.assert_called_once_with(
        execution=execution,
    )


def test_transition_execution_rejects_invalid_transition():
    from unittest.mock import MagicMock

    import pytest

    from app.enums import ExecutionStatus
    from app.services.executions.execution_service import ExecutionService

    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.PENDING

    service.repository.update = MagicMock()

    with pytest.raises(
        ValueError,
        match="Invalid execution status transition",
    ):
        service.transition_execution(
            execution=execution,
            target_status=ExecutionStatus.COMPLETED,
        )

    assert execution.status == ExecutionStatus.PENDING
    service.repository.update.assert_not_called()
