from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import pandas as pd

from app.strategies.base import Strategy


@dataclass
class BacktestContext:
    """
    Runtime context for a single historical backtest.
    """

    execution_id: UUID
    strategy: Strategy
    initial_capital: float
    current_timestamp: datetime
    market_data: pd.DataFrame
