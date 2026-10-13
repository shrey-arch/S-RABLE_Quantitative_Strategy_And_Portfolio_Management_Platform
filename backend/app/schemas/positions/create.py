from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import PositionStatus


class CreatePositionRequest(BaseModel):
    execution_id: UUID
    instrument_id: UUID
    broker_account_id: UUID | None = None
    quantity: int = Field(gt=0)
    average_price: float = Field(gt=0)
    current_price: float | None = Field(default=None, gt=0)
    market_value: float | None = Field(default=None, ge=0)
    realized_pnl: float = 0
    unrealized_pnl: float = 0
    position_status: PositionStatus = PositionStatus.OPEN
    last_updated_at: datetime
    closed_at: datetime | None = None
