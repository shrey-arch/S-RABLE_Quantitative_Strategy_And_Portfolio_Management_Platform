"""Phase 16: the logged-in user's notifications.

Every route works on the current user's own notifications; another user's id
answers 404. Notifications are created by the backend (a run finishing), not
through the API. A user marks them read / unread or deletes them."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import NotificationPriority, NotificationType
from app.models import User
from app.schemas.notifications import (
    NotificationResponse,
    UnreadCount,
    UpdateNotificationRequest,
)
from app.services.notifications.notification_service import NotificationService


router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
)

NOT_FOUND = "Notification not found."


def _value(item):
    return getattr(item, "value", item)


def _to_response(notification) -> NotificationResponse:
    execution = (
        notification.execution if notification.execution_id is not None else None
    )
    return NotificationResponse(
        id=str(notification.id),
        user_id=str(notification.user_id),
        execution_id=(
            str(notification.execution_id)
            if notification.execution_id is not None
            else None
        ),
        execution_type=_value(execution.execution_type) if execution is not None else None,
        execution_status=_value(execution.status) if execution is not None else None,
        notification_type=_value(notification.notification_type),
        priority=_value(notification.priority),
        title=notification.title,
        message=notification.message,
        is_read=notification.is_read,
        read_at=(
            notification.read_at.isoformat()
            if notification.read_at is not None
            else None
        ),
        notification_data=notification.notification_data,
        created_at=notification.created_at.isoformat(),
        updated_at=notification.updated_at.isoformat(),
    )


def _owned(service: NotificationService, notification_id: UUID, user: User):
    notification = service.get_notification(
        notification_id=notification_id,
        user_id=user.id,
    )
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND)
    return notification


@router.get(
    "",
    response_model=list[NotificationResponse],
)
def list_notifications(
    is_read: bool | None = None,
    notification_type: NotificationType | None = None,
    priority: NotificationPriority | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Newest first. Filters: is_read (false = the Unread tab), type, priority."""
    notifications = NotificationService(db).search_notifications(
        user_id=current_user.id,
        is_read=is_read,
        notification_type=notification_type,
        priority=priority,
    )
    return [_to_response(notification) for notification in notifications]


@router.get(
    "/unread-count",
    response_model=UnreadCount,
)
def unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The header bell: how many of the user's notifications are unread."""
    return UnreadCount(unread=NotificationService(db).count_unread(user_id=current_user.id))


@router.get(
    "/{notification_id}",
    response_model=NotificationResponse,
)
def get_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = NotificationService(db)
    return _to_response(_owned(service, notification_id, current_user))


@router.patch(
    "/{notification_id}",
    response_model=NotificationResponse,
)
def update_notification(
    notification_id: UUID,
    request: UpdateNotificationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark read or unread. read_at is set by the server."""
    service = NotificationService(db)
    notification = _owned(service, notification_id, current_user)
    try:
        notification = service.set_read(notification=notification, is_read=request.is_read)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return _to_response(notification)


@router.delete(
    "/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_notification(
    notification_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    service = NotificationService(db)
    service.delete_notification(notification=_owned(service, notification_id, current_user))
