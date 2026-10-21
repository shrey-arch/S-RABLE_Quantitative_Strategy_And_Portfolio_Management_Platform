from uuid import uuid4
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.main import app
from app.models import User
from app.enums import StrategyType

client = TestClient(app)

def test_strategies_requires_authentication():
    response = client.get("/strategies")

    assert response.status_code == 401

def test_strategies_authenticated():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        response = client.get("/strategies")

        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()

def test_create_strategy():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        import app.api.strategies.routes as strategy_routes

        original_service = strategy_routes.StrategyService

        mock_strategy = MagicMock()
        mock_strategy.id = uuid4()
        mock_strategy.user_id = test_user.id
        mock_strategy.name = "Moving Average Strategy"
        mock_strategy.description = "Test strategy"
        mock_strategy.strategy_type.value = "PYTHON"
        mock_strategy.strategy_config = {
            "fast_period": 10,
            "slow_period": 30,
        }
        mock_strategy.python_code = None
        mock_strategy.version = 1
        mock_strategy.is_active = True
        mock_strategy.created_at = MagicMock()
        mock_strategy.created_at.isoformat.return_value = (
            "2026-09-03T00:00:00+00:00"
        )
        mock_strategy.updated_at = MagicMock()
        mock_strategy.updated_at.isoformat.return_value = (
            "2026-09-03T00:00:00+00:00"
        )

        mock_service = MagicMock()
        mock_service.create_strategy.return_value = mock_strategy

        strategy_routes.StrategyService = lambda db: mock_service

        response = client.post(
            "/strategies",
            json={
                "name": "Moving Average Strategy",
                "description": "Test strategy",
                "strategy_type": "PYTHON",
                "strategy_config": {
                    "parameters": {},
                    "indicators": [],
                    "entry_conditions": [],
                    "exit_conditions": [],
                },
            },
        )

        assert response.status_code == 201

        data = response.json()

        assert data["name"] == "Moving Average Strategy"
        assert data["description"] == "Test strategy"
        assert data["strategy_type"] == "PYTHON"
        assert data["strategy_config"] == {
            "fast_period": 10,
            "slow_period": 30,
        }
        assert data["version"] == 1
        assert data["is_active"] is True

        mock_service.create_strategy.assert_called_once_with(
            user_id=test_user.id,
            name="Moving Average Strategy",
            description="Test strategy",
            strategy_type=StrategyType.PYTHON,
            strategy_config={
                "parameters": {},
                "indicators": [],
                "entry_conditions": [],
                "exit_conditions": [],
            },
            python_code=None,
        )

    finally:
        strategy_routes.StrategyService = original_service
        app.dependency_overrides.clear()

def test_get_strategy():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        import app.api.strategies.routes as strategy_routes

        original_service = strategy_routes.StrategyService

        strategy_id = uuid4()

        mock_strategy = MagicMock()
        mock_strategy.id = strategy_id
        mock_strategy.user_id = test_user.id
        mock_strategy.name = "Moving Average Strategy"
        mock_strategy.description = "Test strategy"
        mock_strategy.strategy_type.value = "PYTHON"
        mock_strategy.strategy_config = {
            "fast_period": 10,
            "slow_period": 30,
        }
        mock_strategy.python_code = None
        mock_strategy.version = 1
        mock_strategy.is_active = True
        mock_strategy.created_at = MagicMock()
        mock_strategy.created_at.isoformat.return_value = (
            "2026-09-03T00:00:00+00:00"
        )
        mock_strategy.updated_at = MagicMock()
        mock_strategy.updated_at.isoformat.return_value = (
            "2026-09-03T00:00:00+00:00"
        )

        mock_service = MagicMock()
        mock_service.get_strategy.return_value = mock_strategy

        strategy_routes.StrategyService = lambda db: mock_service

        response = client.get(f"/strategies/{strategy_id}")

        assert response.status_code == 200

        data = response.json()

        assert data["id"] == str(strategy_id)
        assert data["user_id"] == str(test_user.id)
        assert data["name"] == "Moving Average Strategy"
        assert data["strategy_type"] == "PYTHON"
        assert data["strategy_config"] == {
            "fast_period": 10,
            "slow_period": 30,
        }
        assert data["version"] == 1
        assert data["is_active"] is True

        mock_service.get_strategy.assert_called_once_with(
            strategy_id=strategy_id,
            user_id=test_user.id,
        )

    finally:
        strategy_routes.StrategyService = original_service
        app.dependency_overrides.clear()

def test_get_strategy_not_found():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        import app.api.strategies.routes as strategy_routes

        original_service = strategy_routes.StrategyService

        strategy_id = uuid4()

        mock_service = MagicMock()
        mock_service.get_strategy.return_value = None

        strategy_routes.StrategyService = lambda db: mock_service

        response = client.get(f"/strategies/{strategy_id}")

        assert response.status_code == 404
        assert response.json()["detail"] == "Strategy not found."

        mock_service.get_strategy.assert_called_once_with(
            strategy_id=strategy_id,
            user_id=test_user.id,
        )

    finally:
        strategy_routes.StrategyService = original_service
        app.dependency_overrides.clear()

def test_update_strategy():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        import app.api.strategies.routes as strategy_routes

        original_service = strategy_routes.StrategyService

        strategy_id = uuid4()

        mock_strategy = MagicMock()
        mock_strategy.id = strategy_id
        mock_strategy.user_id = test_user.id
        mock_strategy.name = "Updated Strategy"
        mock_strategy.description = "Updated description"
        mock_strategy.strategy_type.value = "PYTHON"
        mock_strategy.strategy_config = {
            "fast_period": 20,
            "slow_period": 50,
        }
        mock_strategy.python_code = None
        mock_strategy.version = 1
        mock_strategy.is_active = False
        mock_strategy.created_at = MagicMock()
        mock_strategy.created_at.isoformat.return_value = (
            "2026-09-03T00:00:00+00:00"
        )
        mock_strategy.updated_at = MagicMock()
        mock_strategy.updated_at.isoformat.return_value = (
            "2026-09-03T00:01:00+00:00"
        )

        mock_service = MagicMock()
        mock_service.get_strategy.return_value = mock_strategy
        mock_service.update_strategy.return_value = mock_strategy

        strategy_routes.StrategyService = lambda db: mock_service

        response = client.patch(
            f"/strategies/{strategy_id}",
            json={
                "name": "Updated Strategy",
                "description": "Updated description",
                "strategy_config": {
                    "parameters": {},
                    "indicators": [],
                    "entry_conditions": [],
                    "exit_conditions": [],
                },
                "is_active": False,
            },
        )

        assert response.status_code == 200

        data = response.json()

        assert data["name"] == "Updated Strategy"
        assert data["description"] == "Updated description"
        assert data["strategy_config"] == {
            "fast_period": 20,
            "slow_period": 50,
        }
        assert data["is_active"] is False

        mock_service.get_strategy.assert_called_once_with(
            strategy_id=strategy_id,
            user_id=test_user.id,
        )

        mock_service.update_strategy.assert_called_once_with(
            strategy=mock_strategy,
            name="Updated Strategy",
            description="Updated description",
            strategy_config={
                        "parameters": {},
                "indicators": [],
                "entry_conditions": [],
                "exit_conditions": [],
            },
            python_code=None,
            is_active=False,
        )

    finally:
        strategy_routes.StrategyService = original_service
        app.dependency_overrides.clear()

def test_delete_strategy():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        import app.api.strategies.routes as strategy_routes

        original_service = strategy_routes.StrategyService

        strategy_id = uuid4()
        mock_strategy = MagicMock()
        mock_strategy.id = strategy_id
        mock_strategy.user_id = test_user.id

        mock_service = MagicMock()
        mock_service.get_strategy.return_value = mock_strategy

        strategy_routes.StrategyService = lambda db: mock_service

        response = client.delete(f"/strategies/{strategy_id}")

        assert response.status_code == 204
        assert response.content == b""

        mock_service.get_strategy.assert_called_once_with(
            strategy_id=strategy_id,
            user_id=test_user.id,
        )

        mock_service.delete_strategy.assert_called_once_with(
            strategy=mock_strategy,
        )

    finally:
        strategy_routes.StrategyService = original_service
        app.dependency_overrides.clear()

def test_create_strategy_rejects_invalid_config():
    test_user = User(
        id=uuid4(),
        email="strategy-api-test@example.com",
    )

    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        import app.api.strategies.routes as strategy_routes

        original_service = strategy_routes.StrategyService

        mock_service = MagicMock()
        strategy_routes.StrategyService = lambda db: mock_service

        response = client.post(
            "/strategies",
            json={
                "name": "Invalid Strategy",
                "description": "Invalid config test",
                "strategy_type": "NO_CODE",
                "strategy_config": {
                    "parameters": {},
                    "indicators": [],
                    "entry_conditions": [
                        {
                            "left": {
                                "type": "indicator",
                                "name": "missing_indicator",
                            },
                            "operator": "<",
                            "right": {
                                "type": "value",
                                "value": 30,
                            },
                        }
                    ],
                    "exit_conditions": [],
                },
            },
        )

        assert response.status_code == 422
        mock_service.create_strategy.assert_not_called()

    finally:
        strategy_routes.StrategyService = original_service
        app.dependency_overrides.clear()
