from unittest.mock import MagicMock
from uuid import uuid4

from app.models import Strategy
from app.services.strategies.strategy_service import StrategyService


def test_create_strategy():
    db = MagicMock()
    service = StrategyService(db)

    strategy = MagicMock(spec=Strategy)
    service.repository.create_for_user = MagicMock(
        return_value=strategy
    )

    user_id = uuid4()

    result = service.create_strategy(
        user_id=user_id,
        name="Moving Average Strategy",
        description="Test strategy",
        strategy_type="PYTHON",
        strategy_config={
            "fast_period": 10,
            "slow_period": 30,
        },
    )

    assert result == strategy

    service.repository.create_for_user.assert_called_once_with(
        user_id=user_id,
        name="Moving Average Strategy",
        description="Test strategy",
        strategy_type="PYTHON",
        strategy_config={
            "fast_period": 10,
            "slow_period": 30,
        },
        python_code=None,
    )

def test_list_strategies():
    db = MagicMock()
    service = StrategyService(db)

    strategies = [
        MagicMock(spec=Strategy),
        MagicMock(spec=Strategy),
    ]

    service.repository.list_for_user = MagicMock(
        return_value=strategies
    )

    user_id = uuid4()

    result = service.list_strategies(
        user_id=user_id,
    )

    assert result == strategies

    service.repository.list_for_user.assert_called_once_with(
        user_id=user_id,
    )

def test_get_strategy():
    db = MagicMock()
    service = StrategyService(db)

    strategy = MagicMock(spec=Strategy)

    service.repository.get_by_id_for_user = MagicMock(
        return_value=strategy
    )

    strategy_id = uuid4()
    user_id = uuid4()

    result = service.get_strategy(
        strategy_id=strategy_id,
        user_id=user_id,
    )

    assert result == strategy

    service.repository.get_by_id_for_user.assert_called_once_with(
        strategy_id=strategy_id,
        user_id=user_id,
    )

def test_update_strategy():
    db = MagicMock()
    service = StrategyService(db)

    strategy = MagicMock(spec=Strategy)

    service.repository.update_for_user = MagicMock(
        return_value=strategy
    )

    result = service.update_strategy(
        strategy=strategy,
        name="Updated Strategy",
        description="Updated description",
        strategy_config={
            "fast_period": 20,
            "slow_period": 50,
        },
        is_active=False,
    )

    assert result == strategy

    service.repository.update_for_user.assert_called_once_with(
        strategy=strategy,
        name="Updated Strategy",
        description="Updated description",
        strategy_config={
            "fast_period": 20,
            "slow_period": 50,
        },
        python_code=None,
        is_active=False,
    )

def test_delete_strategy():
    db = MagicMock()
    service = StrategyService(db)

    strategy = MagicMock(spec=Strategy)

    service.repository.delete_for_user = MagicMock(
        return_value=None
    )

    result = service.delete_strategy(
        strategy=strategy,
    )

    assert result is None

    service.repository.delete_for_user.assert_called_once_with(
        strategy=strategy,
    )
