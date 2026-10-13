from pydantic import BaseModel, Field


class UpdateBrokerAccountRequest(BaseModel):
    account_alias: str | None = Field(
        default=None,
        max_length=100,
    )
    is_active: bool | None = None