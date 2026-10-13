from pydantic import BaseModel, Field


class ConnectBrokerAccountRequest(BaseModel):
    access_token: str = Field(min_length=1, max_length=500)
    refresh_token: str | None = Field(default=None, max_length=500)