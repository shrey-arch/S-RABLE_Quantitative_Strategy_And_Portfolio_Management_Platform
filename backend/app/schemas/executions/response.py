from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import ExecutionStatus, ExecutionType


class StrategyCodeErrorInfo(BaseModel):
    """Feature 6: where a custom Python strategy failed, so the editor can show it."""

    phase: str | None = Field(default=None, description='"check", "load" or "bar".')
    exception: str | None = None
    message: str | None = None
    line: int | None = Field(default=None, description="The line in the user's code.")
    bar_date: str | None = Field(default=None, description="The bar it failed on.")
    traceback: str | None = Field(default=None, description="The user's frames only.")


class ExecutionErrorInfo(BaseModel):
    """Why a run failed, as the backend classified it."""

    category: str | None = None
    code: str | None = None
    message: str | None = None
    stage: str | None = None
    strategy_error: StrategyCodeErrorInfo | None = Field(
        default=None,
        description="Set when custom Python code was refused or failed while running.",
    )


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
    run_settings: dict | None = None
    error_message: str | None
    error: ExecutionErrorInfo | None = None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
