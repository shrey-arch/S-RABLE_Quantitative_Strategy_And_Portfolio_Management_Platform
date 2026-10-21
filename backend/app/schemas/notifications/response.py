from typing import Any


from pydantic import BaseModel


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    execution_id: str | None
    # The linked run as it is now (None when there is no run or it was deleted).
    execution_type: str | None = None
    execution_status: str | None = None
    notification_type: str
    priority: str
    title: str
    message: str
    is_read: bool
    read_at: str | None
    notification_data: dict[str, Any] | None
    created_at: str
    updated_at: str


class UnreadCount(BaseModel):
    unread: int
