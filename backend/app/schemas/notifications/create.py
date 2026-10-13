from uuid import UUID

from pydantic import BaseModel, Field

from app.enums import NotificationPriority, NotificationType


class CreateNotificationRequest(BaseModel):
    user_id: UUID
    execution_id: UUID | None = None
    notification_type: NotificationType
    priority: NotificationPriority = NotificationPriority.MEDIUM
    title: str = Field(min_length=1, max_length=150)
    message: str = Field(min_length=1)
    notification_data: dict | None = None
