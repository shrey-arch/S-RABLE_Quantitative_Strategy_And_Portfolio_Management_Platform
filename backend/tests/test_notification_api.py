from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient

import app.api.notifications.routes as notification_routes
from app.main import app
from app.models import Notification


client = TestClient(app)


def _mock_notification():
    notification = MagicMock(spec=Notification)

    notification.id = uuid4()
    notification.user_id = uuid4()
    notification.execution_id = uuid4()
    notification.notification_type = "INFO"
    notification.priority = "MEDIUM"
    notification.title = "Test notification"
    notification.message = "Test message"
    notification.is_read = False
    notification.read_at = None
    notification.notification_data = {"source": "test"}

    notification.created_at = MagicMock()
    notification.created_at.isoformat.return_value = (
        "2026-10-02T10:00:00+00:00"
    )

    notification.updated_at = MagicMock()
    notification.updated_at.isoformat.return_value = (
        "2026-10-02T10:00:00+00:00"
    )

    return notification


def test_notification_api_create():
    notification = _mock_notification()

    mock_service = MagicMock()
    mock_service.create_notification.return_value = notification

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    user_id = notification.user_id
    execution_id = notification.execution_id

    try:
        response = client.post(
            "/notifications",
            json={
                "user_id": str(user_id),
                "execution_id": str(execution_id),
                "notification_type": "INFO",
                "priority": "MEDIUM",
                "title": "Test notification",
                "message": "Test message",
                "notification_data": {"source": "test"},
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["id"] == str(notification.id)
        assert data["user_id"] == str(user_id)
        assert data["execution_id"] == str(execution_id)
        assert data["notification_type"] == "INFO"
        assert data["priority"] == "MEDIUM"
        assert data["title"] == "Test notification"
        assert data["message"] == "Test message"
        assert data["is_read"] is False
        assert data["notification_data"] == {"source": "test"}

        mock_service.create_notification.assert_called_once()

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_list():
    notification = _mock_notification()

    mock_service = MagicMock()
    mock_service.list_notifications.return_value = [notification]

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    user_id = notification.user_id

    try:
        response = client.get(
            "/notifications",
            params={"user_id": str(user_id)},
        )

        assert response.status_code == 200

        data = response.json()

        assert len(data) == 1
        assert data[0]["id"] == str(notification.id)
        assert data[0]["title"] == "Test notification"

        mock_service.list_notifications.assert_called_once_with(
            user_id=user_id,
        )

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_get():
    notification = _mock_notification()

    mock_service = MagicMock()
    mock_service.get_notification.return_value = notification

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    try:
        response = client.get(
            f"/notifications/{notification.id}",
            params={"user_id": str(notification.user_id)},
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(notification.id)
        assert data["message"] == "Test message"

        mock_service.get_notification.assert_called_once_with(
            notification_id=notification.id,
            user_id=notification.user_id,
        )

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_get_not_found():
    mock_service = MagicMock()
    mock_service.get_notification.return_value = None

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    notification_id = uuid4()
    user_id = uuid4()

    try:
        response = client.get(
            f"/notifications/{notification_id}",
            params={"user_id": str(user_id)},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Notification not found."

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_update():
    notification = _mock_notification()

    mock_service = MagicMock()
    mock_service.get_notification.return_value = notification
    mock_service.update_notification.return_value = notification

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    try:
        response = client.patch(
            f"/notifications/{notification.id}",
            params={"user_id": str(notification.user_id)},
            json={
                "title": "Updated title",
                "message": "Updated message",
                "priority": "HIGH",
                "is_read": True,
            },
        )

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(notification.id)

        mock_service.update_notification.assert_called_once()

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_update_not_found():
    mock_service = MagicMock()
    mock_service.get_notification.return_value = None

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    notification_id = uuid4()
    user_id = uuid4()

    try:
        response = client.patch(
            f"/notifications/{notification_id}",
            params={"user_id": str(user_id)},
            json={
                "title": "Updated title",
            },
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Notification not found."

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_delete():
    notification = _mock_notification()

    mock_service = MagicMock()
    mock_service.get_notification.return_value = notification

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    try:
        response = client.delete(
            f"/notifications/{notification.id}",
            params={"user_id": str(notification.user_id)},
        )

        assert response.status_code == 204

        mock_service.delete_notification.assert_called_once_with(
            notification=notification,
        )

    finally:
        notification_routes.NotificationService = original_service


def test_notification_api_delete_not_found():
    mock_service = MagicMock()
    mock_service.get_notification.return_value = None

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    notification_id = uuid4()
    user_id = uuid4()

    try:
        response = client.delete(
            f"/notifications/{notification_id}",
            params={"user_id": str(user_id)},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Notification not found."

    finally:
        notification_routes.NotificationService = original_service
def test_update_notification_accepts_datetime_read_at(monkeypatch):
    from datetime import datetime, timezone
    from uuid import uuid4

    notification_id = uuid4()
    user_id = uuid4()
    read_at = datetime.now(timezone.utc).replace(microsecond=0)

    class MockService:
        def get_notification(self, *, notification_id, user_id):
            return MagicMock(
                id=notification_id,
                user_id=user_id,
            )

        def update_notification(self, **kwargs):
            assert kwargs["is_read"] is True
            assert kwargs["read_at"] == read_at
            return MagicMock(
                id=notification_id,
                user_id=user_id,
                execution_id=None,
                notification_type="INFO",
                priority="MEDIUM",
                title="Test title",
                message="Test message",
                is_read=True,
                read_at=read_at,
                notification_data=None,
                created_at=read_at,
                updated_at=read_at,
            )

    mock_service = MockService()

    monkeypatch.setattr(
        "app.api.notifications.routes.NotificationService",
        lambda db: mock_service,
    )

    response = client.patch(
        f"/notifications/{notification_id}",
        params={"user_id": str(user_id)},
        json={
            "is_read": True,
            "read_at": read_at.isoformat(),
        },
    )

    assert response.status_code == 200
    assert response.json()["is_read"] is True
    assert response.json()["read_at"] == read_at.isoformat()

def test_notification_api_create_execution_notification():
    notification = _mock_notification()

    mock_service = MagicMock()
    mock_service.create_execution_notification.return_value = notification

    original_service = notification_routes.NotificationService
    notification_routes.NotificationService = lambda db: mock_service

    user_id = notification.user_id
    execution_id = notification.execution_id

    try:
        response = client.post(
            "/notifications/execution",
            json={
                "user_id": str(user_id),
                "execution_id": str(execution_id),
                "notification_type": "INFO",
                "priority": "MEDIUM",
                "title": "Execution started",
                "message": "Execution has started.",
                "notification_data": {
                    "event": "execution_started"
                },
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["id"] == str(notification.id)
        assert data["user_id"] == str(user_id)
        assert data["execution_id"] == str(execution_id)
        assert data["is_read"] is False

        mock_service.create_execution_notification.assert_called_once_with(
            user_id=user_id,
            execution_id=execution_id,
            notification_type="INFO",
            priority="MEDIUM",
            title="Execution started",
            message="Execution has started.",
            notification_data={
                "event": "execution_started"
            },
        )

    finally:
        notification_routes.NotificationService = original_service
