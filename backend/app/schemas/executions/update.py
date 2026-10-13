from pydantic import BaseModel


class UpdateExecutionRequest(BaseModel):
    execution_config: dict | None = None