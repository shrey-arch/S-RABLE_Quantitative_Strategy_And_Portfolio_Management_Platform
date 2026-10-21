import builtins
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Execution, Strategy


class ExecutionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        strategy_id: UUID,
        broker_account_id: UUID | None,
        instrument_id: UUID | None,
        execution_type,
        status,
        timeframe: str,
        initial_capital,
        execution_config: dict | None,
        run_settings: dict | None = None,
    ) -> Execution:
        execution = Execution(
            strategy_id=strategy_id,
            broker_account_id=broker_account_id,
            instrument_id=instrument_id,
            execution_type=execution_type,
            status=status,
            timeframe=timeframe,
            initial_capital=initial_capital,
            execution_config=execution_config,
            run_settings=run_settings,
        )

        self.db.add(execution)
        self.db.commit()
        self.db.refresh(execution)

        return execution

    def list(self) -> list[Execution]:
        statement = (
            select(Execution)
            .order_by(Execution.created_at.desc())
        )

        return list(self.db.scalars(statement).all())

    def list_for_user(
        self,
        *,
        user_id: UUID,
        status=None,
        execution_type=None,
        strategy_id: UUID | None = None,
        instrument_id: UUID | None = None,
        created_from: datetime | None = None,
        created_to: datetime | None = None,
        limit: int = 200,
    ) -> "builtins.list[Execution]":
        """Executions of the user's own strategies, newest first."""
        statement = (
            select(Execution)
            .join(Strategy, Strategy.id == Execution.strategy_id)
            .where(Strategy.user_id == user_id)
        )
        if status is not None:
            statement = statement.where(Execution.status == status)
        if execution_type is not None:
            statement = statement.where(Execution.execution_type == execution_type)
        if strategy_id is not None:
            statement = statement.where(Execution.strategy_id == strategy_id)
        if instrument_id is not None:
            statement = statement.where(Execution.instrument_id == instrument_id)
        if created_from is not None:
            statement = statement.where(Execution.created_at >= created_from)
        if created_to is not None:
            statement = statement.where(Execution.created_at <= created_to)

        statement = statement.order_by(Execution.created_at.desc()).limit(limit)
        return builtins.list(self.db.scalars(statement).all())

    def get_by_id_for_user(
        self,
        *,
        execution_id: UUID,
        user_id: UUID,
    ) -> Execution | None:
        statement = (
            select(Execution)
            .join(Strategy, Strategy.id == Execution.strategy_id)
            .where(Execution.id == execution_id, Strategy.user_id == user_id)
        )
        return self.db.scalar(statement)

    def lock(self, execution: Execution) -> Execution:
        """Re-read the row and hold it until the next commit, so two status
        changes (e.g. the worker completing and the user cancelling) cannot both
        win."""
        self.db.refresh(execution, with_for_update=True)
        return execution

    def get_by_id(
        self,
        *,
        execution_id: UUID,
    ) -> Execution | None:
        statement = (
            select(Execution)
            .where(Execution.id == execution_id)
        )

        return self.db.scalar(statement)

    def update(
        self,
        *,
        execution: Execution,
        execution_config: dict | None = None,
    ) -> Execution:
        if execution_config is not None:
            execution.execution_config = execution_config

        self.db.commit()
        self.db.refresh(execution)

        return execution

    def delete(
        self,
        *,
        execution: Execution,
    ) -> None:
        self.db.delete(execution)
        self.db.commit()