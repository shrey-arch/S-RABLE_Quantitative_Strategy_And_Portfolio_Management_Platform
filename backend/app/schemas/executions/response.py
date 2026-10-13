from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.enums import ExecutionStatus, ExecutionType


class ExecutionResponse(BaseModel):
    id: UUID
    strategy_id: UUID
    broker_account_id: UUID | None
    instrument_id: UUID | None
    execution_type: ExecutionType
    status: ExecutionStatus
    timeframe: str
    initial_capital: float
    execution_config: dict | None
    execution_metrics: dict | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime