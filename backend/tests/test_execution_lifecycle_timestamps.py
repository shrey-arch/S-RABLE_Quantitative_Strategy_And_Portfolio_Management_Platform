from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app.enums import ExecutionStatus
from app.services.executions.execution_service import ExecutionService


def test_transition_to_running_sets_started_at():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.PENDING
    execution.started_at = None
    execution.completed_at = None

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.transition_execution(
        execution=execution,
        target_status=ExecutionStatus.RUNNING,
    )

    assert result == execution
    assert execution.status == ExecutionStatus.RUNNING
    assert isinstance(execution.started_at, datetime)
    assert execution.started_at.tzinfo == timezone.utc
    assert execution.completed_at is None


def test_transition_to_completed_sets_completed_at():
    db = MagicMock()
    service = ExecutionService(db)

    execution = MagicMock()
    execution.status = ExecutionStatus.RUNNING
    execution.started_at = datetime.now(timezone.utc)
    execution.completed_at = None

    service.repository.update = MagicMock(
        return_value=execution,
    )

    result = service.transition_execution(
        execution=execution,
        target_status=ExecutionStatus.COMPLETED,
    )

    assert result == execution
    assert execution.status == ExecutionStatus.COMPLETED
    assert execution.started_at is not None
    assert isinstance(execution.completed_at, datetime)
    assert execution.completed_at.tzinfo == timezone.utc


@pytest.mark.parametrize(
    "target_status",
    [
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
    ],
)
def test_terminal_failure_or_cancellation_sets_completed_at(
    target_status,
):
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

    transition_kwargs = {
        "execution": execution,
        "target_status": target_status,
    }

    if target_status == ExecutionStatus.FAILED:
        transition_kwargs["error_message"] = "Execution failed."

    result = service.transition_execution(
        **transition_kwargs,
    )

    assert result == execution
    assert execution.status == target_status
    assert execution.completed_at is not None
    assert execution.completed_at.tzinfo == timezone.utc
