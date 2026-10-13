from pydantic import BaseModel, Field

from app.enums import BrokerName


class CreateBrokerAccountRequest(BaseModel):
    broker_name: BrokerName
    broker_user_id: str = Field(min_length=1, max_length=100)
    account_alias: str | None = Field(
        default=None,
        max_length=100,
    )
    api_key: str = Field(min_length=1, max_length=255)
    api_secret: str = Field(min_length=1, max_length=255)


class BrokerAccountResponse(BaseModel):
    id: str
    broker_name: str
    broker_user_id: str
    account_alias: str | None
    connection_status: str
    is_active: bool
    last_synced_at: str | None
    created_at: str