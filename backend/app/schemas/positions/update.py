from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import PositionStatus


class UpdatePositionRequest(BaseModel):
    broker_account_id: UUID | None = None
    quantity: int | None = Field(default=None, gt=0)
    average_price: float | None = Field(default=None, gt=0)
    current_price: float | None = Field(default=None, gt=0)
    market_value: float | None = Field(default=None, ge=0)
    realized_pnl: float | None = None
    unrealized_pnl: float | None = None
    position_status: PositionStatus | None = None
    last_updated_at: datetime | None = None
    closed_at: datetime | None = None
