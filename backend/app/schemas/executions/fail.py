from pydantic import BaseModel, Field


class FailExecutionRequest(BaseModel):
    error_message: str = Field(min_length=1)
