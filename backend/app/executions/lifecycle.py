from app.enums import ExecutionStatus


ALLOWED_TRANSITIONS: dict[ExecutionStatus, set[ExecutionStatus]] = {
    # A job can fail or be cancelled before its worker starts it (e.g. the worker
    # could not be started, or the user cancelled while it was waiting).
    ExecutionStatus.PENDING: {
        ExecutionStatus.RUNNING,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
    },
    ExecutionStatus.RUNNING: {
        ExecutionStatus.COMPLETED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
    },
    ExecutionStatus.COMPLETED: set(),
    ExecutionStatus.FAILED: set(),
    ExecutionStatus.CANCELLED: set(),
}


def can_transition(
    current_status: ExecutionStatus,
    target_status: ExecutionStatus,
) -> bool:
    return target_status in ALLOWED_TRANSITIONS[current_status]
