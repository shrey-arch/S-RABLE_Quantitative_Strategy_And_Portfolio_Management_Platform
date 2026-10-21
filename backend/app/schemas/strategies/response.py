from typing import Any

from pydantic import BaseModel

from app.schemas.validation.status import ValidationStatus


class StrategyResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: str | None
    strategy_type: str
    strategy_config: dict[str, Any]
    python_code: str | None
    version: int
    is_active: bool
    created_at: str
    updated_at: str
    validation: ValidationStatus
