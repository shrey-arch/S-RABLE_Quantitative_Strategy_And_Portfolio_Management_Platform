from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class IndicatorParameterInfo(BaseModel):
    name: str
    type: Literal["int", "float"]
    description: str
    required: bool
    default: int | float | None = None
    minimum: float | None = None
    exclusive_minimum: bool = False


class IndicatorInfo(BaseModel):
    key: str
    name: str
    category: str
    panel: Literal["price", "separate"]
    definition: str
    outputs: list[str]
    parameters: list[IndicatorParameterInfo]
    rules: list[str]
    required_columns: list[str]
    used_by: list[str]


class IndicatorParameters(BaseModel):
    parameters: dict[str, Any] = Field(default_factory=dict)


class IndicatorValidationResult(BaseModel):
    key: str
    parameters: dict[str, int | float]


class IndicatorSeriesRequest(BaseModel):
    parameters: dict[str, Any] = Field(default_factory=dict)
    start_date: date | None = None
    end_date: date | None = None


class IndicatorPoint(BaseModel):
    timestamp: datetime
    values: dict[str, float | None]


class IndicatorSeries(BaseModel):
    instrument_id: str
    key: str
    panel: Literal["price", "separate"]
    parameters: dict[str, int | float]
    outputs: list[str]
    points: list[IndicatorPoint]
