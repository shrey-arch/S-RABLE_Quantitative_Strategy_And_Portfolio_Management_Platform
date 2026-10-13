from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.notifications import (
    CreateNotificationRequest,
    NotificationResponse,
    UpdateNotificationRequest,
)
from app.services.notifications.notification_service import NotificationService


router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
)


def _to_response(notification) -> NotificationResponse:
    return NotificationResponse(
        id=str(notification.id),
        user_id=str(notification.user_id),
        execution_id=(
            str(notification.execution_id)
            if notification.execution_id is not None
            else None
        ),
        notification_type=notification.notification_type,
        priority=notification.priority,
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


@router.post(
    "",
    response_model=NotificationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_notification(
    request: CreateNotificationRequest,
    db: Session = Depends(get_db),
):
    notification_service = NotificationService(db)

    notification = notification_service.create_notification(
        user_id=request.user_id,
        execution_id=request.execution_id,
        notification_type=request.notification_type,
        priority=request.priority,
        title=request.title,
        message=request.message,
        notification_data=request.notification_data,
    )

    return _to_response(notification)


@router.get(
    "",
    response_model=list[NotificationResponse],
)
def list_notifications(
    user_id: UUID,
    db: Session = Depends(get_db),
):
    notification_service = NotificationService(db)

    notifications = notification_service.list_notifications(
        user_id=user_id,
    )

    return [_to_response(notification) for notification in notifications]


@router.post(
    "/execution",
    response_model=NotificationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_execution_notification(
    request: CreateNotificationRequest,
    db: Session = Depends(get_db),
):
    notification_service = NotificationService(db)

    notification = notification_service.create_execution_notification(
        user_id=request.user_id,
        execution_id=request.execution_id,
        notification_type=request.notification_type,
        priority=request.priority,
        title=request.title,
        message=request.message,
        notification_data=request.notification_data,
    )

    return _to_response(notification)


@router.get(
    "/{notification_id}",
    response_model=NotificationResponse,
)
def get_notification(
    notification_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
):
    notification_service = NotificationService(db)

    notification = notification_service.get_notification(
        notification_id=notification_id,
        user_id=user_id,
    )

    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )

    return _to_response(notification)


@router.patch(
    "/{notification_id}",
    response_model=NotificationResponse,
)
def update_notification(
    notification_id: UUID,
    user_id: UUID,
    request: UpdateNotificationRequest,
    db: Session = Depends(get_db),
):
    notification_service = NotificationService(db)

    notification = notification_service.get_notification(
        notification_id=notification_id,
        user_id=user_id,
    )

    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )

    notification = notification_service.update_notification(
        notification=notification,
        execution_id=request.execution_id,
        notification_type=request.notification_type,
        priority=request.priority,
        title=request.title,
        message=request.message,
        is_read=request.is_read,
        read_at=request.read_at,
        notification_data=request.notification_data,
    )

    return _to_response(notification)


@router.delete(
    "/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_notification(
    notification_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),
):
    notification_service = NotificationService(db)

    notification = notification_service.get_notification(
        notification_id=notification_id,
        user_id=user_id,
    )

    if not notification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )

    notification_service.delete_notification(
        notification=notification,
    )
