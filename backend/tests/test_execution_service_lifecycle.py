from unittest.mock import MagicMock

from app.enums import ExecutionStatus
from app.services.executions.execution_service import ExecutionService


def test_transition_execution():
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
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.PENDING

    service.repository.update = MagicMock()

    import pytest

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


def test_start_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.PENDING

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.start_execution(
        execution=execution,
    )

    assert execution.status == ExecutionStatus.RUNNING
    assert result == execution

    service.repository.update.assert_called_once_with(
        execution=execution,
    )


def test_complete_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.complete_execution(
        execution=execution,
    )

    assert execution.status == ExecutionStatus.COMPLETED
    assert result == execution

    service.repository.update.assert_called_once_with(
        execution=execution,
    )


def test_fail_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.fail_execution(
        execution=execution,
        error_message="Backtest failed.",
    )

    assert execution.status == ExecutionStatus.FAILED
    assert execution.error_message == "Backtest failed."
    assert result == execution

    service.repository.update.assert_called_once_with(
        execution=execution,
    )


def test_cancel_execution():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.cancel_execution(
        execution=execution,
    )

    assert execution.status == ExecutionStatus.CANCELLED
    assert result == execution

    service.repository.update.assert_called_once_with(
        execution=execution,
    )
