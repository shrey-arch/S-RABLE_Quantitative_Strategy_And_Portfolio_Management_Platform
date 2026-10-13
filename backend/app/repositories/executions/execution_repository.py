from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Execution


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