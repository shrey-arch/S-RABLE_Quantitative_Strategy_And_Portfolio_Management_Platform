from app.enums import OrderStatus


ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.PENDING: {
        OrderStatus.OPEN,
        OrderStatus.CANCELLED,
    },
    OrderStatus.OPEN: {
        OrderStatus.COMPLETED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
    },
    OrderStatus.COMPLETED: set(),
    OrderStatus.CANCELLED: set(),
    OrderStatus.REJECTED: set(),
}


def can_transition(
    current_status: OrderStatus,
    target_status: OrderStatus,
) -> bool:
    return target_status in ALLOWED_TRANSITIONS[current_status]
