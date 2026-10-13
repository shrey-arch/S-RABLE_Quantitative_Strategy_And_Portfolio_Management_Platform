from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CreateBacktestRequest(BaseModel):
    strategy_id: UUID
    strategy_key: str = Field(min_length=1)
    instrument_id: UUID
    timeframe: str = Field(min_length=1, max_length=20)
    initial_capital: float = Field(gt=0)
    start_timestamp: datetime | None = None
    end_timestamp: datetime | None = None
    execution_config: dict | None = None
    quantity: int = Field(default=1, gt=0)
