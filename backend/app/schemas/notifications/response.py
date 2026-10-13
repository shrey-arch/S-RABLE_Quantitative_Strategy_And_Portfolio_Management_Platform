from typing import Any


from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    execution_id: str | None
    notification_type: str
    priority: str
    title: str
    message: str
    is_read: bool
    read_at: str | None
    notification_data: dict[str, Any] | None
    created_at: str
    updated_at: str
