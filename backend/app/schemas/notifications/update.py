from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import NotificationPriority, NotificationType


class UpdateNotificationRequest(BaseModel):
    execution_id: UUID | None = None
    notification_type: NotificationType | None = None
    priority: NotificationPriority | None = None
    title: str | None = Field(default=None, min_length=1, max_length=150)
    message: str | None = Field(default=None, min_length=1)
    is_read: bool | None = None
    read_at: datetime | None = None
    notification_data: dict | None = None
