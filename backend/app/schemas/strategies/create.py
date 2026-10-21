from pydantic import BaseModel, Field, model_validator

from app.enums import StrategyType
from app.schemas.strategies.config import StrategyConfig
from app.schemas.strategies.python_code import check_python_code


class CreateStrategyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = None
    strategy_type: StrategyType
    strategy_config: StrategyConfig
    python_code: str | None = Field(
        default=None,
        description=(
            "Source of a PYTHON strategy that defines generate_signal(context). "
            "Checked for syntax and stored only; it is never run."
        ),
    )

    @model_validator(mode="after")
    def check_code_matches_type(self):
        if self.python_code is None:
            return self
        if self.strategy_type != StrategyType.PYTHON:
            raise ValueError("Only PYTHON strategies can have python_code.")
        check_python_code(self.python_code)
        return self
