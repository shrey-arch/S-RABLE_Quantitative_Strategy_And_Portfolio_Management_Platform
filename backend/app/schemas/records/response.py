from uuid import UUID

from pydantic import BaseModel


class RecordCounts(BaseModel):
    """How many trading records a backtest has stored (all simulated)."""

    execution_id: UUID
    stored: bool
    orders: int
    trades: int
    positions: int
