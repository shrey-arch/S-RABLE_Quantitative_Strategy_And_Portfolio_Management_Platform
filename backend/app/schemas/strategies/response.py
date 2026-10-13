from typing import Any

from pydantic import BaseModel


class StrategyResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: str | None
    strategy_type: str
    strategy_config: dict[str, Any]
    version: int
    is_active: bool
    created_at: str
    updated_at: str