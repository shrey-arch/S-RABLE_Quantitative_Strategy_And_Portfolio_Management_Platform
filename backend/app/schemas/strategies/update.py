from pydantic import BaseModel, Field, field_validator

from app.schemas.strategies.config import StrategyConfig
from app.schemas.strategies.python_code import check_python_code


class UpdateStrategyRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    strategy_config: StrategyConfig | None = None
    python_code: str | None = None
    is_active: bool | None = None

    @field_validator("python_code")
    @classmethod
    def check_code(cls, value: str | None) -> str | None:
        return None if value is None else check_python_code(value)
