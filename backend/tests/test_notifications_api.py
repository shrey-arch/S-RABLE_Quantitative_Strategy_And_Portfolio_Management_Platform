"""Phase 16: notifications, broker accounts and profile against the real database.

Notifications: login + owner on every route, no create route, made by the
backend when a run finishes, read / unread set by the server, unread count.
Brokers: connect / disconnect, secrets never returned, 409 duplicate, one user
cannot see another's account. Profile: login records last_login_at, only the
editable fields are accepted."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.dependencies import get_current_user
from app.core.security import hash_password
from app.db import SessionLocal
from app.enums import ExecutionStatus, ExecutionType, StrategyType
from app.main import app
from app.models import BrokerAccount, Execution, Notification, Strategy, User
from app.services.executions.execution_service import ExecutionService

client = TestClient(app)
SECRETS = ("api_key", "api_secret", "access_token", "refresh_token")


@pytest.fixture
def world():
    db = SessionLocal()
    user = User(
        full_name="Notify",
        email=f"ntf-{uuid4().hex[:8]}@example.com",
        password_hash=hash_password("Password123!"),
    )
    other = User(full_name="Other", email=f"nto-{uuid4().hex[:8]}@example.com", password_hash="x")
    db.add_all([user, other])
    db.commit()
    strategies = []

    def run(owner, kind=ExecutionType.BACKTEST, name="Notify run"):
        strategy = Strategy(
            user_id=owner.id,
            name=name,
            strategy_type=StrategyType.PYTHON,
            strategy_config={"parameters": {"template": "momentum"}},
        )
        db.add(strategy)
        db.flush()
        strategies.append(strategy)
        execution = Execution(
            strategy_id=strategy.id,
            execution_type=kind,
            status=ExecutionStatus.PENDING,
            timeframe="1D",
            initial_capital=10000,
            execution_config={},
        )
        db.add(execution)
        db.commit()
        return execution

    app.dependency_overrides[get_current_user] = lambda: user
    try:
        yield {"db": db, "user": user, "other": other, "run": run}
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        db.rollback()
        ids = [s.id for s in strategies]
        users = [user.id, other.id]
        db.execute(delete(Notification).where(Notification.user_id.in_(users)))
        db.execute(delete(Execution).where(Execution.strategy_id.in_(ids)))
        db.execute(delete(Strategy).where(Strategy.id.in_(ids)))
        db.execute(delete(BrokerAccount).where(BrokerAccount.user_id.in_(users)))
        db.execute(delete(User).where(User.id.in_(users)))
        db.commit()
        db.close()


def as_user(user):
    app.dependency_overrides[get_current_user] = lambda: user


def finish(world, execution, status, error=None):
    service = ExecutionService(world["db"])
    service.start_execution(execution=execution)
    if status == ExecutionStatus.COMPLETED:
        service.complete_execution(execution=execution)
    elif status == ExecutionStatus.FAILED:
        service.fail_execution(execution=execution, error_message=error)
    else:
        service.cancel_execution(execution=execution)


def unread():
    response = client.get("/notifications/unread-count")
    assert response.status_code == 200, response.text
    return response.json()["unread"]


# --- notifications ----------------------------------------------------------


def test_notification_routes_need_login():
    some = uuid4()
    assert client.get("/notifications").status_code == 401
    assert client.get("/notifications/unread-count").status_code == 401
    assert client.get(f"/notifications/{some}").status_code == 401
    assert client.patch(f"/notifications/{some}", json={"is_read": True}).status_code == 401
    assert client.delete(f"/notifications/{some}").status_code == 401


def test_there_is_no_create_route(world):
    body = {
        "user_id": str(world["other"].id),
        "notification_type": "INFO",
        "title": "x",
        "message": "y",
    }
    assert client.post("/notifications", json=body).status_code == 405
    assert client.post("/notifications/execution", json=body).status_code in {404, 405}


def test_a_finished_run_notifies_its_owner_once(world):
    done = world["run"](world["user"], name="Momentum A")
    failed = world["run"](world["user"], kind=ExecutionType.VALIDATION, name="Check B")
    cancelled = world["run"](world["user"], name="Cancel C")
    running = world["run"](world["user"], name="Still running")
    finish(world, done, ExecutionStatus.COMPLETED)
    finish(world, failed, ExecutionStatus.FAILED, error="No market data.")
    finish(world, cancelled, ExecutionStatus.CANCELLED)
    ExecutionService(world["db"]).start_execution(execution=running)

    items = client.get("/notifications").json()
    assert len(items) == 3
    by_run = {n["execution_id"]: n for n in items}
    assert set(by_run) == {str(done.id), str(failed.id), str(cancelled.id)}

    ok = by_run[str(done.id)]
    assert ok["user_id"] == str(world["user"].id)
    assert ok["title"] == "Backtest completed"
    assert ok["message"] == 'Backtest of "Momentum A" completed.'
    assert (ok["notification_type"], ok["priority"]) == ("INFO", "MEDIUM")
    assert (ok["execution_type"], ok["execution_status"]) == ("BACKTEST", "COMPLETED")
    assert ok["is_read"] is False and ok["read_at"] is None
    assert ok["notification_data"]["event"] == "EXECUTION_FINISHED"

    bad = by_run[str(failed.id)]
    assert bad["title"] == "Validation failed"
    assert bad["message"] == 'Validation of "Check B" failed. No market data.'
    assert (bad["notification_type"], bad["priority"]) == ("ERROR", "HIGH")
    assert (bad["execution_type"], bad["execution_status"]) == ("VALIDATION", "FAILED")

    stop = by_run[str(cancelled.id)]
    assert stop["title"] == "Backtest was cancelled"
    assert (stop["notification_type"], stop["priority"]) == ("WARNING", "LOW")

    # Newest first.
    assert [n["created_at"] for n in items] == sorted((n["created_at"] for n in items), reverse=True)
    # The other user sees none of them.
    as_user(world["other"])
    assert client.get("/notifications").json() == []
    assert unread() == 0


def test_mark_read_updates_the_unread_count_and_read_at(world):
    for name in ("One", "Two"):
        finish(world, world["run"](world["user"], name=name), ExecutionStatus.COMPLETED)
    assert unread() == 2
    first = client.get("/notifications").json()[0]

    response = client.patch(f"/notifications/{first['id']}", json={"is_read": True})
    assert response.status_code == 200, response.text
    read = response.json()
    assert read["is_read"] is True and read["read_at"] is not None
    assert unread() == 1
    # Marking read again keeps the first read time.
    again = client.patch(f"/notifications/{first['id']}", json={"is_read": True}).json()
    assert again["read_at"] == read["read_at"]

    unread_only = client.get("/notifications", params={"is_read": "false"}).json()
    assert [n["id"] for n in unread_only] != [first["id"]] and len(unread_only) == 1

    back = client.patch(f"/notifications/{first['id']}", json={"is_read": False}).json()
    assert back["is_read"] is False and back["read_at"] is None
    assert unread() == 2


def test_patch_takes_is_read_only(world):
    finish(world, world["run"](world["user"]), ExecutionStatus.COMPLETED)
    item = client.get("/notifications").json()[0]
    for body in ({"title": "changed"}, {"is_read": True, "title": "changed"}, {}):
        assert client.patch(f"/notifications/{item['id']}", json=body).status_code == 422
    assert client.get(f"/notifications/{item['id']}").json()["title"] == item["title"]


def test_type_and_priority_filters(world):
    finish(world, world["run"](world["user"]), ExecutionStatus.COMPLETED)
    finish(world, world["run"](world["user"]), ExecutionStatus.FAILED, error="Boom.")
    errors = client.get("/notifications", params={"notification_type": "ERROR"}).json()
    assert [n["notification_type"] for n in errors] == ["ERROR"]
    high = client.get("/notifications", params={"priority": "HIGH"}).json()
    assert [n["priority"] for n in high] == ["HIGH"]
    assert client.get("/notifications", params={"priority": "URGENT"}).status_code == 422


def test_another_users_notification_is_not_found(world):
    finish(world, world["run"](world["other"]), ExecutionStatus.COMPLETED)
    as_user(world["other"])
    theirs = client.get("/notifications").json()[0]["id"]
    as_user(world["user"])
    assert client.get(f"/notifications/{theirs}").status_code == 404
    assert client.patch(f"/notifications/{theirs}", json={"is_read": True}).status_code == 404
    assert client.delete(f"/notifications/{theirs}").status_code == 404
    as_user(world["other"])
    assert client.get(f"/notifications/{theirs}").json()["is_read"] is False


def test_delete(world):
    finish(world, world["run"](world["user"]), ExecutionStatus.COMPLETED)
    item = client.get("/notifications").json()[0]["id"]
    assert client.delete(f"/notifications/{item}").status_code == 204
    assert client.get(f"/notifications/{item}").status_code == 404
    assert client.get("/notifications").json() == []
    assert unread() == 0


def test_a_deleted_run_leaves_its_notification_unlinked(world):
    run = world["run"](world["user"])
    finish(world, run, ExecutionStatus.COMPLETED)
    world["db"].execute(delete(Execution).where(Execution.id == run.id))
    world["db"].commit()
    item = client.get("/notifications").json()[0]
    assert item["execution_id"] is None
    assert item["execution_type"] is None and item["execution_status"] is None


def test_a_broken_notification_never_changes_the_run(world, monkeypatch):
    import app.services.notifications.execution_events as events

    def broken(self, **kwargs):
        raise RuntimeError("store down")

    monkeypatch.setattr(events.NotificationService, "create_notification", broken)
    run = world["run"](world["user"])
    finish(world, run, ExecutionStatus.COMPLETED)
    world["db"].expire_all()
    stored = world["db"].scalar(select(Execution).where(Execution.id == run.id))
    assert stored.status == ExecutionStatus.COMPLETED
    assert client.get("/notifications").json() == []


# --- broker accounts -------------------------------------------------------


def new_account(**changes):
    body = {
        "broker_name": "ZERODHA",
        "broker_user_id": f"ZX{uuid4().hex[:6].upper()}",
        "account_alias": "Main",
        "api_key": "key-123",
        "api_secret": "secret-456",
    }
    body.update(changes)
    return client.post("/brokers/accounts", json=body)


def no_secrets(item):
    for key in SECRETS:
        assert key not in item
    text = str(item)
    for value in ("key-123", "secret-456", "tok-1", "ref-1"):
        assert value not in text


def test_broker_connect_and_disconnect(world):
    created = new_account()
    assert created.status_code == 201, created.text
    account = created.json()
    no_secrets(account)
    assert account["connection_status"] == "DISCONNECTED" and account["is_active"] is True
    path = f"/brokers/accounts/{account['id']}"

    connected = client.post(f"{path}/connect", json={"access_token": "tok-1", "refresh_token": "ref-1"})
    assert connected.status_code == 200, connected.text
    assert connected.json()["connection_status"] == "CONNECTED"
    no_secrets(connected.json())
    stored = world["db"].scalar(select(BrokerAccount).where(BrokerAccount.id == account["id"]))
    assert stored.access_token == "tok-1" and stored.refresh_token == "ref-1"

    assert client.post(f"{path}/connect", json={"access_token": ""}).status_code == 422

    disconnected = client.post(f"{path}/disconnect")
    assert disconnected.json()["connection_status"] == "DISCONNECTED"
    world["db"].expire_all()
    stored = world["db"].scalar(select(BrokerAccount).where(BrokerAccount.id == account["id"]))
    assert stored.access_token is None and stored.refresh_token is None

    listed = client.get("/brokers/accounts").json()
    assert [a["id"] for a in listed] == [account["id"]]
    no_secrets(listed[0])


def test_broker_edit_duplicate_and_delete(world):
    account = new_account(broker_user_id="DUP1").json()
    duplicate = new_account(broker_user_id="DUP1", account_alias="Again")
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "This broker account is already connected to your account."
    # The same broker user id at another broker is allowed.
    assert new_account(broker_user_id="DUP1", broker_name="UPSTOX").status_code == 201

    path = f"/brokers/accounts/{account['id']}"
    edited = client.patch(path, json={"account_alias": "Renamed", "is_active": False}).json()
    assert (edited["account_alias"], edited["is_active"]) == ("Renamed", False)
    cleared = client.patch(path, json={"account_alias": ""}).json()
    assert cleared["account_alias"] is None and cleared["is_active"] is False

    assert client.delete(path).status_code == 204
    assert client.get(path).status_code == 404


def test_second_user_cannot_see_first_users_broker(world):
    account = new_account().json()
    path = f"/brokers/accounts/{account['id']}"
    as_user(world["other"])
    assert client.get("/brokers/accounts").json() == []
    assert client.get(path).status_code == 404
    assert client.patch(path, json={"account_alias": "Mine"}).status_code == 404
    assert client.post(f"{path}/connect", json={"access_token": "tok-1"}).status_code == 404
    assert client.post(f"{path}/disconnect").status_code == 404
    assert client.delete(path).status_code == 404
    # The same broker identity is a separate account for the second user.
    same = new_account(broker_user_id=account["broker_user_id"])
    assert same.status_code == 201
    as_user(world["user"])
    assert client.get(path).json()["account_alias"] == "Main"


# --- profile ---------------------------------------------------------------


def login(world) -> dict:
    """A real login, so the profile routes load the user in their own session."""
    app.dependency_overrides.pop(get_current_user, None)
    token = client.post(
        "/auth/login", json={"email": world["user"].email, "password": "Password123!"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_login_records_last_login(world):
    user = world["user"]
    assert user.last_login_at is None
    profile = client.get("/users/me", headers=login(world)).json()
    assert profile["last_login_at"] is not None
    assert profile["email"] == user.email
    assert profile["account_status"] == "ACTIVE" and profile["email_verified"] is False


def test_profile_edits_only_accepted_fields(world):
    auth = login(world)
    response = client.patch(
        "/users/me",
        headers=auth,
        json={
            "full_name": "  New Name ",
            "phone_number": "+91 98765 43210",
            "profile_image_url": "https://example.com/me.png",
        },
    )
    assert response.status_code == 200, response.text
    profile = response.json()
    assert profile["full_name"] == "New Name"
    assert profile["phone_number"] == "+91 98765 43210"
    assert profile["profile_image_url"] == "https://example.com/me.png"

    for body in (
        {"email": "x@example.com"},
        {"account_status": "SUSPENDED"},
        {"profile_image_url": "javascript:alert(1)"},
        {"phone_number": "call me"},
        {"full_name": " a "},
    ):
        assert client.patch("/users/me", headers=auth, json=body).status_code == 422, body

    cleared = client.patch(
        "/users/me", headers=auth, json={"phone_number": "", "profile_image_url": ""}
    ).json()
    assert cleared["phone_number"] is None and cleared["profile_image_url"] is None
    assert client.get("/users/me", headers=auth).json()["full_name"] == "New Name"
