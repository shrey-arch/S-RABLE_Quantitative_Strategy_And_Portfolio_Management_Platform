from unittest.mock import MagicMock
from uuid import uuid4

from app.models import Strategy
from app.repositories.strategies.strategy_repository import (
    StrategyRepository,
)


def test_create_for_user():
    db = MagicMock()
    repository = StrategyRepository(db)

    user_id = uuid4()

    strategy = repository.create_for_user(
        user_id=user_id,
        name="Moving Average Strategy",
        description="Test strategy",
        strategy_type="PYTHON",
        strategy_config={
            "fast_period": 10,
            "slow_period": 30,
        },
    )

    db.add.assert_called_once()
    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(strategy)

    assert strategy.user_id == user_id
    assert strategy.name == "Moving Average Strategy"
    assert strategy.description == "Test strategy"
    assert strategy.strategy_config == {
        "fast_period": 10,
        "slow_period": 30,
    }

def test_list_for_user():
    db = MagicMock()
    repository = StrategyRepository(db)

    first_strategy = MagicMock(spec=Strategy)
    second_strategy = MagicMock(spec=Strategy)

    db.scalars.return_value.all.return_value = [
        first_strategy,
        second_strategy,
    ]

    strategies = repository.list_for_user(
        user_id=uuid4(),
    )

    assert strategies == [
        first_strategy,
        second_strategy,
    ]

    db.scalars.assert_called_once()

def test_get_by_id_for_user():
    db = MagicMock()
    repository = StrategyRepository(db)

    strategy = MagicMock(spec=Strategy)
    db.scalar.return_value = strategy

    strategy_id = uuid4()
    user_id = uuid4()

    result = repository.get_by_id_for_user(
        strategy_id=strategy_id,
        user_id=user_id,
    )

    assert result == strategy
    db.scalar.assert_called_once()

def test_update_for_user():
    db = MagicMock()
    repository = StrategyRepository(db)

    strategy = MagicMock(spec=Strategy)

    result = repository.update_for_user(
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
    assert strategy.name == "Updated Strategy"
    assert strategy.description == "Updated description"
    assert strategy.strategy_config == {
        "fast_period": 20,
        "slow_period": 50,
    }
    assert strategy.is_active is False

    db.commit.assert_called_once()
    db.refresh.assert_called_once_with(strategy)

def test_delete_for_user():
    db = MagicMock()
    repository = StrategyRepository(db)

    strategy = MagicMock(spec=Strategy)

    result = repository.delete_for_user(
        strategy=strategy,
    )

    assert result is None
    db.delete.assert_called_once_with(strategy)
    db.commit.assert_called_once()
