from datetime import datetime, timezone
from uuid import uuid4
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import AccountStatus
from app.main import app
from app.models import User
import app.api.auth.routes as auth_routes
import app.api.users.routes as user_routes


client = TestClient(app)


def make_user():
    user = User(
        id=uuid4(),
        full_name="API Test User",
        email="api-test@example.com",
        password_hash="not-a-real-password-hash",
        account_status=AccountStatus.ACTIVE,
        email_verified=False,
        phone_number=None,
        profile_image_url=None,
    )
    user.created_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    user.updated_at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    user.last_login_at = None
    return user


def test_register_returns_created_user(monkeypatch):
    user = make_user()
    service = MagicMock()
    service.register_user.return_value = user
    monkeypatch.setattr(auth_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(auth_routes, "get_db", lambda: None)

    response = client.post(
        "/auth/register",
        json={
            "full_name": user.full_name,
            "email": user.email,
            "password": "ValidPassword123!",
        },
    )

    assert response.status_code == 201
    assert response.json()["id"] == str(user.id)
    assert response.json()["email"] == user.email
    service.register_user.assert_called_once()


def test_register_rejects_invalid_payload():
    response = client.post(
        "/auth/register",
        json={"full_name": "A", "email": "not-an-email", "password": "short"},
    )
    assert response.status_code == 422


def test_register_conflict_returns_409(monkeypatch):
    service = MagicMock()
    service.register_user.side_effect = ValueError("Email already registered")
    monkeypatch.setattr(auth_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(auth_routes, "get_db", lambda: None)

    response = client.post(
        "/auth/register",
        json={
            "full_name": "API Test User",
            "email": "duplicate@example.com",
            "password": "ValidPassword123!",
        },
    )

    assert response.status_code == 409


def test_login_returns_bearer_token(monkeypatch):
    service = MagicMock()
    service.login_user.return_value = "test-access-token"
    monkeypatch.setattr(auth_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(auth_routes, "get_db", lambda: None)

    response = client.post(
        "/auth/login",
        json={"email": "api-test@example.com", "password": "ValidPassword123!"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "access_token": "test-access-token",
        "token_type": "bearer",
    }


def test_login_invalid_credentials_returns_401(monkeypatch):
    service = MagicMock()
    service.login_user.side_effect = ValueError("Invalid credentials")
    monkeypatch.setattr(auth_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(auth_routes, "get_db", lambda: None)

    response = client.post(
        "/auth/login",
        json={"email": "api-test@example.com", "password": "ValidPassword123!"},
    )

    assert response.status_code == 401
    assert response.headers.get("www-authenticate") == "Bearer"


def test_change_password_requires_authentication():
    response = client.post(
        "/auth/change-password",
        json={
            "current_password": "OldPassword123!",
            "new_password": "NewPassword123!",
        },
    )
    assert response.status_code == 401


def test_change_password_success(monkeypatch):
    user = make_user()
    service = MagicMock()
    monkeypatch.setattr(auth_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(auth_routes, "get_db", lambda: None)
    app.dependency_overrides[get_current_user] = lambda: user

    try:
        response = client.post(
            "/auth/change-password",
            json={
                "current_password": "OldPassword123!",
                "new_password": "NewPassword123!",
            },
        )
        assert response.status_code == 204
        service.change_password.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_change_password_rejected_by_service_returns_400(monkeypatch):
    user = make_user()
    service = MagicMock()
    service.change_password.side_effect = ValueError("Incorrect current password")
    monkeypatch.setattr(auth_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(auth_routes, "get_db", lambda: None)
    app.dependency_overrides[get_current_user] = lambda: user

    try:
        response = client.post(
            "/auth/change-password",
            json={
                "current_password": "WrongPassword123!",
                "new_password": "NewPassword123!",
            },
        )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_get_profile_requires_authentication():
    response = client.get("/users/me")
    assert response.status_code == 401


def test_get_profile_returns_current_user():
    user = make_user()
    app.dependency_overrides[get_current_user] = lambda: user

    try:
        response = client.get("/users/me")
        assert response.status_code == 200
        assert response.json()["id"] == str(user.id)
        assert response.json()["email"] == user.email
        assert response.json()["full_name"] == user.full_name
    finally:
        app.dependency_overrides.clear()


def test_update_profile_calls_service(monkeypatch):
    user = make_user()
    updated_user = make_user()
    updated_user.full_name = "Updated API User"
    updated_user.phone_number = "+911234567890"

    service = MagicMock()
    service.update_profile.return_value = updated_user
    monkeypatch.setattr(user_routes, "AuthService", lambda db: service)
    monkeypatch.setattr(user_routes, "get_db", lambda: None)
    app.dependency_overrides[get_current_user] = lambda: user

    try:
        response = client.patch(
            "/users/me",
            json={
                "full_name": updated_user.full_name,
                "phone_number": updated_user.phone_number,
            },
        )
        assert response.status_code == 200
        assert response.json()["full_name"] == updated_user.full_name
        assert response.json()["phone_number"] == updated_user.phone_number
        service.update_profile.assert_called_once()
    finally:
        app.dependency_overrides.clear()


def test_update_profile_requires_authentication():
    response = client.patch("/users/me", json={"full_name": "Updated API User"})
    assert response.status_code == 401
