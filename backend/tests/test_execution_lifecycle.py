from app.enums import ExecutionStatus
from app.executions.lifecycle import can_transition


def test_pending_can_transition_to_running():
    assert can_transition(
        ExecutionStatus.PENDING,
        ExecutionStatus.RUNNING,
    )


def test_running_can_transition_to_completed():
    assert can_transition(
        ExecutionStatus.RUNNING,
        ExecutionStatus.COMPLETED,
    )


def test_running_can_transition_to_failed():
    assert can_transition(
        ExecutionStatus.RUNNING,
        ExecutionStatus.FAILED,
    )


def test_running_can_transition_to_cancelled():
    assert can_transition(
        ExecutionStatus.RUNNING,
        ExecutionStatus.CANCELLED,
    )


def test_pending_cannot_transition_to_completed():
    assert not can_transition(
        ExecutionStatus.PENDING,
        ExecutionStatus.COMPLETED,
    )


def test_pending_can_transition_to_failed():
    assert can_transition(
        ExecutionStatus.PENDING,
        ExecutionStatus.FAILED,
    )


def test_pending_can_transition_to_cancelled():
    assert can_transition(
        ExecutionStatus.PENDING,
        ExecutionStatus.CANCELLED,
    )


def test_completed_is_terminal():
    for status in ExecutionStatus:
        assert not can_transition(
            ExecutionStatus.COMPLETED,
            status,
        )


def test_failed_is_terminal():
    for status in ExecutionStatus:
        assert not can_transition(
            ExecutionStatus.FAILED,
            status,
        )


def test_cancelled_is_terminal():
    for status in ExecutionStatus:
        assert not can_transition(
            ExecutionStatus.CANCELLED,
            status,
        )
