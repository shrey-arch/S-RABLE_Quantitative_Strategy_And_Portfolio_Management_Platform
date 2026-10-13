from pydantic import BaseModel, Field

from app.enums import StrategyType
from app.schemas.strategies.config import StrategyConfig


class CreateStrategyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    strategy_type: StrategyType
    strategy_config: StrategyConfig