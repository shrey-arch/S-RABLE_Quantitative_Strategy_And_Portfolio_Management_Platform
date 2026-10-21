from uuid import UUID

from app.models import Strategy
from app.repositories.strategies.strategy_repository import (
    StrategyRepository,
)


class StrategyService:
    def __init__(self, db):
        self.repository = StrategyRepository(db)

    def create_strategy(
        self,
        *,
        user_id: UUID,
        name: str,
        description: str | None,
        strategy_type,
        strategy_config: dict,
        python_code: str | None = None,
    ) -> Strategy:
        return self.repository.create_for_user(
            user_id=user_id,
            name=name,
            description=description,
            strategy_type=strategy_type,
            strategy_config=strategy_config,
            python_code=python_code,
        )

    def list_strategies(
        self,
        *,
        user_id: UUID,
    ) -> list[Strategy]:
        return self.repository.list_for_user(
            user_id=user_id,
        )

    def get_strategy(
        self,
        *,
        strategy_id: UUID,
        user_id: UUID,
    ) -> Strategy | None:
        return self.repository.get_by_id_for_user(
            strategy_id=strategy_id,
            user_id=user_id,
        )

    def update_strategy(
        self,
        *,
        strategy: Strategy,
        name: str | None = None,
        description: str | None = None,
        strategy_config: dict | None = None,
        python_code: str | None = None,
        is_active: bool | None = None,
    ) -> Strategy:
        return self.repository.update_for_user(
            strategy=strategy,
            name=name,
            description=description,
            strategy_config=strategy_config,
            python_code=python_code,
            is_active=is_active,
        )

    def delete_strategy(
        self,
        *,
        strategy: Strategy,
    ) -> None:
        self.repository.delete_for_user(
            strategy=strategy,
        )