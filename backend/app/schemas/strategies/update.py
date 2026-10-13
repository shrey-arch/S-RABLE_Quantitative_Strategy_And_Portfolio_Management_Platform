from pydantic import BaseModel, Field

from app.schemas.strategies.config import StrategyConfig


class UpdateStrategyRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    strategy_config: StrategyConfig | None = None
    is_active: bool | None = None