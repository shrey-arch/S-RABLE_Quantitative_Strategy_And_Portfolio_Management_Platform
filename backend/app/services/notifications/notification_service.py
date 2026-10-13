from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.enums import NotificationPriority, NotificationType
from app.models import Notification
from app.repositories.notifications.notification_repository import (
    NotificationRepository,
)


_UNSET = object()


class NotificationService:
    def __init__(self, db: Session):
        self.repository = NotificationRepository(db)

    def create_notification(
        self,
        *,
        user_id: UUID,
        execution_id: UUID | None,
        notification_type: NotificationType,
        priority: NotificationPriority,
        title: str,
        message: str,
        notification_data: dict | None,
        is_read: bool = False,
        read_at=None,
    ) -> Notification:
        self._validate_content(
            title=title,
            message=message,
            notification_data=notification_data,
        )

        self._validate_read_state(
            is_read=is_read,
            read_at=read_at,
        )

        return self.repository.create_for_user(
            user_id=user_id,
            execution_id=execution_id,
            notification_type=notification_type,
            priority=priority,
            title=title,
            message=message,
            notification_data=notification_data,
            is_read=is_read,
            read_at=read_at,
        )

    def create_execution_notification(
        self,
        *,
        user_id: UUID,
        execution_id: UUID,
        notification_type: NotificationType,
        priority: NotificationPriority,
        title: str,
        message: str,
        notification_data: dict | None,
    ) -> Notification:
        return self.create_notification(
            user_id=user_id,
            execution_id=execution_id,
            notification_type=notification_type,
            priority=priority,
            title=title,
            message=message,
            notification_data=notification_data,
            is_read=False,
            read_at=None,
        )

    def list_notifications(
        self,
        *,
        user_id: UUID,
    ) -> list[Notification]:
        return self.repository.list_for_user(
            user_id=user_id,
        )

    def get_notification(
        self,
        *,
        notification_id: UUID,
        user_id: UUID,
    ) -> Notification | None:
        return self.repository.get_by_id_for_user(
            notification_id=notification_id,
            user_id=user_id,
        )

    def get_required_notification(
        self,
        *,
        notification_id: UUID,
        user_id: UUID,
    ) -> Notification:
        notification = self.get_notification(
            notification_id=notification_id,
            user_id=user_id,
        )

        if notification is None:
            raise ValueError("Notification not found.")

        return notification

    def update_notification(
        self,
        *,
        notification: Notification,
        execution_id: UUID | None = None,
        notification_type: NotificationType | None = None,
        priority: NotificationPriority | None = None,
        title: str | None = None,
        message: str | None = None,
        is_read: bool | None = None,
        read_at=_UNSET,
        notification_data: dict | None = None,
    ) -> Notification:
        self._validate_content(
            title=title,
            message=message,
            notification_data=notification_data,
            allow_none=True,
        )

        effective_is_read = (
            is_read
            if is_read is not None
            else notification.is_read
        )

        effective_read_at = (
            read_at
            if read_at is not _UNSET
            else notification.read_at
        )

        self._validate_read_state(
            is_read=effective_is_read,
            read_at=effective_read_at,
        )

        repository_read_at = (
            read_at
            if read_at is not _UNSET
            else _UNSET
        )

        return self.repository.update_for_user(
            notification=notification,
            execution_id=execution_id,
            notification_type=notification_type,
            priority=priority,
            title=title,
            message=message,
            is_read=is_read,
            read_at=repository_read_at,
            notification_data=notification_data,
        )

    def delete_notification(
        self,
        *,
        notification: Notification,
    ) -> None:
        return self.repository.delete_for_user(
            notification=notification,
        )

    @staticmethod
    def _validate_content(
        *,
        title: str | None,
        message: str | None,
        notification_data: dict | None,
        allow_none: bool = False,
    ) -> None:
        if title is not None:
            if not title.strip():
                raise ValueError("Notification title cannot be blank.")
        elif not allow_none:
            raise ValueError("Notification title is required.")

        if message is not None:
            if not message.strip():
                raise ValueError("Notification message cannot be blank.")
        elif not allow_none:
            raise ValueError("Notification message is required.")

        if (
            notification_data is not None
            and not isinstance(notification_data, dict)
        ):
            raise ValueError("Notification data must be an object.")

    @staticmethod
    def _validate_read_state(
        *,
        is_read: bool,
        read_at,
    ) -> None:
        if not is_read and read_at is not None:
            raise ValueError(
                "Unread notification cannot have a read timestamp."
            )

        if is_read and read_at is None:
            raise ValueError(
                "Read notification must have a read timestamp."
            )

        if read_at is not None:
            if read_at.tzinfo is None or read_at.utcoffset() is None:
                raise ValueError(
                    "Read timestamp must be timezone-aware."
                )

            now = datetime.now(timezone.utc)

            if read_at > now:
                raise ValueError(
                    "Read timestamp cannot be in the future."
                )
