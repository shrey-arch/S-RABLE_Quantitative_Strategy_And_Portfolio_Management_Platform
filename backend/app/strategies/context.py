from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass
class StrategyContext:
    instrument: Any
    timestamp: datetime
    market_data: dict[str, Any]
