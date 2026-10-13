import pytest

from app.enums import OrderStatus
from app.orders.lifecycle import can_transition


@pytest.mark.parametrize(
    ("current_status", "target_status"),
    [
        (OrderStatus.PENDING, OrderStatus.OPEN),
        (OrderStatus.PENDING, OrderStatus.CANCELLED),
        (OrderStatus.OPEN, OrderStatus.COMPLETED),
        (OrderStatus.OPEN, OrderStatus.CANCELLED),
        (OrderStatus.OPEN, OrderStatus.REJECTED),
    ],
)
def test_allowed_order_transitions(current_status, target_status):
    assert can_transition(current_status, target_status) is True


@pytest.mark.parametrize(
    ("current_status", "target_status"),
    [
        (OrderStatus.PENDING, OrderStatus.COMPLETED),
        (OrderStatus.PENDING, OrderStatus.REJECTED),
        (OrderStatus.OPEN, OrderStatus.PENDING),
        (OrderStatus.COMPLETED, OrderStatus.PENDING),
        (OrderStatus.COMPLETED, OrderStatus.OPEN),
        (OrderStatus.COMPLETED, OrderStatus.CANCELLED),
        (OrderStatus.CANCELLED, OrderStatus.PENDING),
        (OrderStatus.CANCELLED, OrderStatus.OPEN),
        (OrderStatus.CANCELLED, OrderStatus.COMPLETED),
        (OrderStatus.REJECTED, OrderStatus.PENDING),
        (OrderStatus.REJECTED, OrderStatus.OPEN),
        (OrderStatus.REJECTED, OrderStatus.COMPLETED),
    ],
)
def test_invalid_order_transitions(current_status, target_status):
    assert can_transition(current_status, target_status) is False


@pytest.mark.parametrize(
    "terminal_status",
    [
        OrderStatus.COMPLETED,
        OrderStatus.CANCELLED,
        OrderStatus.REJECTED,
    ],
)
def test_terminal_order_states_have_no_transitions(terminal_status):
    for target_status in OrderStatus:
        assert can_transition(terminal_status, target_status) is False
