from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Strategy


class StrategyRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_for_user(
        self,
        *,
        user_id: UUID,
        name: str,
        description: str | None,
        strategy_type,
        strategy_config: dict,
        python_code: str | None = None,
    ) -> Strategy:
        strategy = Strategy(
            user_id=user_id,
            name=name,
            description=description,
            strategy_type=strategy_type,
            strategy_config=strategy_config,
            python_code=python_code,
        )

        self.db.add(strategy)
        self.db.commit()
        self.db.refresh(strategy)

        return strategy

    def list_for_user(
        self,
        *,
        user_id: UUID,
    ) -> list[Strategy]:
        statement = (
            select(Strategy)
            .where(Strategy.user_id == user_id)
            .order_by(Strategy.created_at.desc())
        )

        return list(self.db.scalars(statement).all())

    def get_by_id_for_user(
        self,
        *,
        strategy_id: UUID,
        user_id: UUID,
    ) -> Strategy | None:
        statement = (
            select(Strategy)
            .where(
                Strategy.id == strategy_id,
                Strategy.user_id == user_id,
            )
        )

        return self.db.scalar(statement)

    def update_for_user(
        self,
        *,
        strategy: Strategy,
        name: str | None = None,
        description: str | None = None,
        strategy_config: dict | None = None,
        python_code: str | None = None,
        is_active: bool | None = None,
    ) -> Strategy:
        # The version counts changes to what the strategy does (its rules or its
        # code). Renaming, editing the description or toggling it does not count.
        changed = False

        if name is not None:
            strategy.name = name

        if description is not None:
            strategy.description = description

        if strategy_config is not None:
            changed = changed or strategy_config != strategy.strategy_config
            strategy.strategy_config = strategy_config

        if python_code is not None:
            changed = changed or python_code != strategy.python_code
            strategy.python_code = python_code

        if changed:
            strategy.version = int(strategy.version or 1) + 1

        if is_active is not None:
            strategy.is_active = is_active

        self.db.commit()
        self.db.refresh(strategy)

        return strategy

    def delete_for_user(
        self,
        *,
        strategy: Strategy,
    ) -> None:
        self.db.delete(strategy)
        self.db.commit()