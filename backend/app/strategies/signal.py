from datetime import datetime
from enum import Enum


class SignalAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"
    # Close the position (back to flat). Used by no-code rule strategies (long only).
    EXIT = "EXIT"


class StrategySignal:
    def __init__(
        self,
        action: SignalAction,
        timestamp: datetime,
        allocations: dict[str, float] | None = None,
        quantity: int | None = None,
    ):
        self.action = action
        self.timestamp = timestamp
        self.allocations = allocations or {}
        # Feature 6: a custom Python strategy may size a single-instrument signal.
        # None means "use the run's quantity". Ignored for allocation signals.
        self.quantity = quantity
