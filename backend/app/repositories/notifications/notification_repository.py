from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification


_UNSET = object()


class NotificationRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_for_user(
        self,
        *,
        user_id: UUID,
        execution_id: UUID | None,
        notification_type,
        priority,
        title: str,
        message: str,
        is_read: bool = False,
        read_at=None,
        notification_data: dict | None = None,
    ) -> Notification:
        notification = Notification(
            user_id=user_id,
            execution_id=execution_id,
            notification_type=notification_type,
            priority=priority,
            title=title,
            message=message,
            is_read=is_read,
            read_at=read_at,
            notification_data=notification_data,
        )
        self.db.add(notification)
        self.db.commit()
        self.db.refresh(notification)
        return notification

    def list_for_user(
        self,
        *,
        user_id: UUID,
    ) -> list[Notification]:
        statement = (
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.created_at.desc())
        )
        return list(self.db.scalars(statement).all())

    def get_by_id_for_user(
        self,
        *,
        notification_id: UUID,
        user_id: UUID,
    ) -> Notification | None:
        statement = select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
        )
        return self.db.scalar(statement)

    def update_for_user(
        self,
        *,
        notification: Notification,
        execution_id: UUID | None = None,
        notification_type=None,
        priority=None,
        title: str | None = None,
        message: str | None = None,
        is_read: bool | None = None,
        read_at=_UNSET,
        notification_data: dict | None = None,
    ) -> Notification:
        if execution_id is not None:
            notification.execution_id = execution_id

        if notification_type is not None:
            notification.notification_type = notification_type

        if priority is not None:
            notification.priority = priority

        if title is not None:
            notification.title = title

        if message is not None:
            notification.message = message

        if is_read is not None:
            notification.is_read = is_read

        if read_at is not _UNSET:
            notification.read_at = read_at

        if notification_data is not None:
            notification.notification_data = notification_data

        self.db.commit()
        self.db.refresh(notification)
        return notification

    def delete_for_user(
        self,
        *,
        notification: Notification,
    ) -> None:
        self.db.delete(notification)
        self.db.commit()
