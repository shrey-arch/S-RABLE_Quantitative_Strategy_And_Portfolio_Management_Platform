from app.enums import ExecutionStatus


ALLOWED_TRANSITIONS: dict[ExecutionStatus, set[ExecutionStatus]] = {
    ExecutionStatus.PENDING: {
        ExecutionStatus.RUNNING,
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
