"""Feature 6: the test run and the context API reference."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field


class TestRunRequest(BaseModel):
    instrument_id: UUID
    bars: int = Field(default=200, ge=20, le=2000, description="The last N stored daily bars.")
    quantity: int = Field(default=1, gt=0, le=1_000_000, description="Shares a BUY or SELL holds.")
    cash: float = Field(default=100_000, gt=0, description="The cash the code sees (context.cash).")
    parameters: dict = Field(default_factory=dict, description="context.params for this run.")


class TestRunBar(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class TestRunSignal(BaseModel):
    index: int
    date: str
    close: float
    action: str
    quantity: int | None = Field(description="The size the code asked for, if any.")
    position: int = Field(description="Shares held after this signal.")
    changed: bool = Field(description="True when the position changed on this bar.")
    logs: list[str]


class StrategyCodeErrorOut(BaseModel):
    code: str = "STRATEGY_CODE_ERROR"
    phase: str = Field(description='"check", "load" or "bar".')
    exception: str
    message: str
    line: int | None
    bar_date: str | None
    traceback: str | None = None


class TestRunResponse(BaseModel):
    strategy_id: str
    instrument_id: str
    symbol: str
    bars: list[TestRunBar]
    signals: list[TestRunSignal]
    logs: list[str]
    error: StrategyCodeErrorOut | None = Field(
        description="Set when the code failed; the signals before it are still returned."
    )
    sandbox: str = Field(description='Which sandbox ran it: "docker" or "process".')
    limits: list[dict]
    simulation_only: bool = True


class SandboxReference(BaseModel):
    entry_point: str
    allowed_imports: list[str]
    context_api: list[dict]
    return_values: list[dict]
    indicators: list[dict]
    limits: list[dict]
    rules: list[str]
    example: str
    sandbox: str
    docker_available: bool
    max_code_chars: int
