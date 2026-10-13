from datetime import datetime
from enum import Enum


class SignalAction(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"


class StrategySignal:
    def __init__(
        self,
        action: SignalAction,
        timestamp: datetime,
        allocations: dict[str, float] | None = None,
    ):
        self.action = action
        self.timestamp = timestamp
        self.allocations = allocations or {}
