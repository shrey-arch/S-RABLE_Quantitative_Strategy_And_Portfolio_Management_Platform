from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app.enums import ExecutionStatus
from app.services.executions.execution_service import ExecutionService


def test_failed_transition_requires_error_message():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING
    execution.started_at = datetime.now(timezone.utc)
    execution.completed_at = None
    execution.error_message = None

    service.repository.update = MagicMock(
        return_value=execution,
    )

    with pytest.raises(
        ValueError,
        match="Error message is required",
    ):
        service.transition_execution(
            execution=execution,
            target_status=ExecutionStatus.FAILED,
        )

    assert execution.status == ExecutionStatus.RUNNING
    assert execution.completed_at is None
    service.repository.update.assert_not_called()


def test_failed_transition_stores_error_message():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING
    execution.started_at = datetime.now(timezone.utc)
    execution.completed_at = None
    execution.error_message = None

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.transition_execution(
        execution=execution,
        target_status=ExecutionStatus.FAILED,
        error_message="Backtest failed.",
    )

    assert result == execution
    assert execution.status == ExecutionStatus.FAILED
    assert execution.error_message == "Backtest failed."
    assert execution.completed_at is not None


def test_completed_transition_does_not_keep_error_message():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING
    execution.started_at = datetime.now(timezone.utc)
    execution.completed_at = None
    execution.error_message = "Previous error."

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.transition_execution(
        execution=execution,
        target_status=ExecutionStatus.COMPLETED,
    )

    assert result == execution
    assert execution.status == ExecutionStatus.COMPLETED
    assert execution.error_message is None
    assert execution.completed_at is not None


def test_cancelled_transition_does_not_require_error_message():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING
    execution.started_at = datetime.now(timezone.utc)
    execution.completed_at = None
    execution.error_message = None

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.transition_execution(
        execution=execution,
        target_status=ExecutionStatus.CANCELLED,
    )

    assert result == execution
    assert execution.status == ExecutionStatus.CANCELLED
    assert execution.error_message is None
    assert execution.completed_at is not None
