from unittest.mock import MagicMock
from uuid import uuid4

from app.models import Notification
from app.services.notifications.notification_service import NotificationService


def test_create_notification():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    service.repository.create_for_user = MagicMock(
        return_value=notification
    )

    user_id = uuid4()
    execution_id = uuid4()

    result = service.create_notification(
        user_id=user_id,
        execution_id=execution_id,
        notification_type="INFO",
        priority="MEDIUM",
        title="Test notification",
        message="Test message",
        notification_data={"source": "test"},
        is_read=False,
        read_at=None,
    )

    assert result == notification

    service.repository.create_for_user.assert_called_once_with(
        user_id=user_id,
        execution_id=execution_id,
        notification_type="INFO",
        priority="MEDIUM",
        title="Test notification",
        message="Test message",
        notification_data={"source": "test"},
        is_read=False,
        read_at=None,
    )


def test_list_notifications():
    db = MagicMock()
    service = NotificationService(db)

    notifications = [
        MagicMock(spec=Notification),
        MagicMock(spec=Notification),
    ]

    service.repository.list_for_user = MagicMock(
        return_value=notifications
    )

    user_id = uuid4()

    result = service.list_notifications(
        user_id=user_id,
    )

    assert result == notifications

    service.repository.list_for_user.assert_called_once_with(
        user_id=user_id,
    )


def test_get_notification():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    service.repository.get_by_id_for_user = MagicMock(
        return_value=notification
    )

    notification_id = uuid4()
    user_id = uuid4()

    result = service.get_notification(
        notification_id=notification_id,
        user_id=user_id,
    )

    assert result == notification

    service.repository.get_by_id_for_user.assert_called_once_with(
        notification_id=notification_id,
        user_id=user_id,
    )


def test_get_required_notification():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    service.repository.get_by_id_for_user = MagicMock(
        return_value=notification
    )

    notification_id = uuid4()
    user_id = uuid4()

    result = service.get_required_notification(
        notification_id=notification_id,
        user_id=user_id,
    )

    assert result == notification


def test_get_required_notification_not_found():
    db = MagicMock()
    service = NotificationService(db)

    service.repository.get_by_id_for_user = MagicMock(
        return_value=None
    )

    notification_id = uuid4()
    user_id = uuid4()

    try:
        service.get_required_notification(
            notification_id=notification_id,
            user_id=user_id,
        )
        assert False, "Expected ValueError"
    except ValueError as exc:
        assert str(exc) == "Notification not found."


def test_update_notification():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    service.repository.update_for_user = MagicMock(
        return_value=notification
    )

    execution_id = uuid4()

    result = service.update_notification(
        notification=notification,
        execution_id=execution_id,
        notification_type="TRADE",
        priority="HIGH",
        title="Updated title",
        message="Updated message",
        is_read=True,
        read_at=datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc),
        notification_data={"updated": True},
    )

    assert result == notification

    service.repository.update_for_user.assert_called_once_with(
        notification=notification,
        execution_id=execution_id,
        notification_type="TRADE",
        priority="HIGH",
        title="Updated title",
        message="Updated message",
        is_read=True,
        read_at=datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc),
        notification_data={"updated": True},
    )


def test_delete_notification():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)

    service.repository.delete_for_user = MagicMock(
        return_value=None
    )

    result = service.delete_notification(
        notification=notification,
    )

    assert result is None

    service.repository.delete_for_user.assert_called_once_with(
        notification=notification,
    )
import pytest
from unittest.mock import MagicMock
from uuid import uuid4

from app.models import Notification
from app.services.notifications.notification_service import NotificationService


def test_create_notification_rejects_blank_title():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Notification title cannot be blank.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="   ",
            message="Valid message",
            notification_data=None,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_rejects_blank_message():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Notification message cannot be blank.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Valid title",
            message="   ",
            notification_data=None,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_requires_title():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Notification title is required.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title=None,
            message="Valid message",
            notification_data=None,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_requires_message():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Notification message is required.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Valid title",
            message=None,
            notification_data=None,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_rejects_non_dict_notification_data():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Notification data must be an object.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Valid title",
            message="Valid message",
            notification_data=["invalid"],
        )

    service.repository.create_for_user.assert_not_called()


def test_update_notification_rejects_blank_title():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.update_for_user = MagicMock()

    notification = MagicMock(spec=Notification)

    with pytest.raises(
        ValueError,
        match="Notification title cannot be blank.",
    ):
        service.update_notification(
            notification=notification,
            title="   ",
        )

    service.repository.update_for_user.assert_not_called()


def test_update_notification_rejects_blank_message():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.update_for_user = MagicMock()

    notification = MagicMock(spec=Notification)

    with pytest.raises(
        ValueError,
        match="Notification message cannot be blank.",
    ):
        service.update_notification(
            notification=notification,
            message="   ",
        )

    service.repository.update_for_user.assert_not_called()


def test_update_notification_rejects_non_dict_notification_data():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.update_for_user = MagicMock()

    notification = MagicMock(spec=Notification)

    with pytest.raises(
        ValueError,
        match="Notification data must be an object.",
    ):
        service.update_notification(
            notification=notification,
            notification_data=["invalid"],
        )

    service.repository.update_for_user.assert_not_called()

from datetime import datetime, timedelta, timezone


def test_create_notification_rejects_unread_with_read_at():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Unread notification cannot have a read timestamp.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Test title",
            message="Test message",
            notification_data=None,
            is_read=False,
            read_at=datetime.now(timezone.utc),
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_rejects_read_without_read_at():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Read notification must have a read timestamp.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Test title",
            message="Test message",
            notification_data=None,
            is_read=True,
            read_at=None,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_accepts_unread_without_read_at():
    db = MagicMock()
    service = NotificationService(db)
    notification = MagicMock(spec=Notification)

    service.repository.create_for_user = MagicMock(
        return_value=notification
    )

    result = service.create_notification(
        user_id=uuid4(),
        execution_id=None,
        notification_type="INFO",
        priority="MEDIUM",
        title="Test title",
        message="Test message",
        notification_data=None,
        is_read=False,
        read_at=None,
    )

    assert result == notification
    service.repository.create_for_user.assert_called_once()


def test_create_notification_accepts_read_with_read_at():
    db = MagicMock()
    service = NotificationService(db)
    notification = MagicMock(spec=Notification)

    service.repository.create_for_user = MagicMock(
        return_value=notification
    )

    read_at = datetime.now(timezone.utc)

    result = service.create_notification(
        user_id=uuid4(),
        execution_id=None,
        notification_type="INFO",
        priority="MEDIUM",
        title="Test title",
        message="Test message",
        notification_data=None,
        is_read=True,
        read_at=read_at,
    )

    assert result == notification
    service.repository.create_for_user.assert_called_once()
def test_update_notification_accepts_marking_unread_notification_as_read():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    notification.is_read = False
    notification.read_at = None

    service.repository.update_for_user = MagicMock(
        return_value=notification
    )

    read_at = datetime.now(timezone.utc)

    result = service.update_notification(
        notification=notification,
        is_read=True,
        read_at=read_at,
    )

    assert result == notification
    service.repository.update_for_user.assert_called_once_with(
        notification=notification,
        execution_id=None,
        notification_type=None,
        priority=None,
        title=None,
        message=None,
        is_read=True,
        read_at=read_at,
        notification_data=None,
    )
def test_update_notification_allows_marking_read_notification_as_unread():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    notification.is_read = True
    notification.read_at = datetime.now(timezone.utc)

    service.repository.update_for_user = MagicMock(
        return_value=notification
    )

    result = service.update_notification(
        notification=notification,
        is_read=False,
        read_at=None,
    )

    assert result == notification
    service.repository.update_for_user.assert_called_once()
def test_update_notification_clears_read_at_when_marked_unread():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    notification.is_read = True
    notification.read_at = datetime.now(timezone.utc)

    service.repository.update_for_user = MagicMock(
        return_value=notification
    )

    service.update_notification(
        notification=notification,
        is_read=False,
        read_at=None,
    )

    service.repository.update_for_user.assert_called_once_with(
        notification=notification,
        execution_id=None,
        notification_type=None,
        priority=None,
        title=None,
        message=None,
        is_read=False,
        read_at=None,
        notification_data=None,
    )
def test_create_notification_rejects_naive_read_at():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    read_at = datetime.now()

    with pytest.raises(
        ValueError,
        match="Read timestamp must be timezone-aware.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Test title",
            message="Test message",
            notification_data=None,
            is_read=True,
            read_at=read_at,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_rejects_future_read_at():
    db = MagicMock()
    service = NotificationService(db)
    service.repository.create_for_user = MagicMock()

    read_at = datetime.now(timezone.utc) + timedelta(minutes=5)

    with pytest.raises(
        ValueError,
        match="Read timestamp cannot be in the future.",
    ):
        service.create_notification(
            user_id=uuid4(),
            execution_id=None,
            notification_type="INFO",
            priority="MEDIUM",
            title="Test title",
            message="Test message",
            notification_data=None,
            is_read=True,
            read_at=read_at,
        )

    service.repository.create_for_user.assert_not_called()


def test_create_notification_accepts_timezone_aware_past_read_at():
    db = MagicMock()
    service = NotificationService(db)
    notification = MagicMock(spec=Notification)

    service.repository.create_for_user = MagicMock(
        return_value=notification
    )

    read_at = datetime.now(timezone.utc) - timedelta(minutes=5)

    result = service.create_notification(
        user_id=uuid4(),
        execution_id=None,
        notification_type="INFO",
        priority="MEDIUM",
        title="Test title",
        message="Test message",
        notification_data=None,
        is_read=True,
        read_at=read_at,
    )

    assert result == notification
    service.repository.create_for_user.assert_called_once()


def test_update_notification_rejects_naive_read_at():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    notification.is_read = False
    notification.read_at = None

    service.repository.update_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Read timestamp must be timezone-aware.",
    ):
        service.update_notification(
            notification=notification,
            is_read=True,
            read_at=datetime.now(),
        )

    service.repository.update_for_user.assert_not_called()


def test_update_notification_rejects_future_read_at():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    notification.is_read = False
    notification.read_at = None

    service.repository.update_for_user = MagicMock()

    with pytest.raises(
        ValueError,
        match="Read timestamp cannot be in the future.",
    ):
        service.update_notification(
            notification=notification,
            is_read=True,
            read_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )

    service.repository.update_for_user.assert_not_called()


def test_update_notification_accepts_valid_read_at():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    notification.is_read = False
    notification.read_at = None

    service.repository.update_for_user = MagicMock(
        return_value=notification
    )

    read_at = datetime.now(timezone.utc) - timedelta(minutes=5)

    result = service.update_notification(
        notification=notification,
        is_read=True,
        read_at=read_at,
    )

    assert result == notification
    service.repository.update_for_user.assert_called_once()
def test_create_execution_notification():
    db = MagicMock()
    service = NotificationService(db)

    notification = MagicMock(spec=Notification)
    service.repository.create_for_user = MagicMock(
        return_value=notification
    )

    user_id = uuid4()
    execution_id = uuid4()

    result = service.create_execution_notification(
        user_id=user_id,
        execution_id=execution_id,
        notification_type="INFO",
        priority="MEDIUM",
        title="Execution started",
        message="Execution has started.",
        notification_data={"event": "execution_started"},
    )

    assert result == notification

    service.repository.create_for_user.assert_called_once_with(
        user_id=user_id,
        execution_id=execution_id,
        notification_type="INFO",
        priority="MEDIUM",
        title="Execution started",
        message="Execution has started.",
        notification_data={"event": "execution_started"},
        is_read=False,
        read_at=None,
    )
