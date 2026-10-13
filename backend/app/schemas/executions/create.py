from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import ExecutionStatus, ExecutionType


class CreateExecutionRequest(BaseModel):
    strategy_id: UUID
    broker_account_id: UUID | None = None
    instrument_id: UUID
    execution_type: ExecutionType
    status: ExecutionStatus
    timeframe: str = Field(min_length=1, max_length=20)
    initial_capital: float = Field(gt=0)
    execution_config: dict | None = None
