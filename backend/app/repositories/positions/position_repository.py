from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Position


class PositionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        execution_id: UUID,
        instrument_id: UUID,
        broker_account_id: UUID | None,
        quantity: int,
        average_price,
        current_price,
        market_value,
        realized_pnl,
        unrealized_pnl,
        position_status,
        last_updated_at: datetime,
        closed_at: datetime | None,
    ) -> Position:
        position = Position(
            execution_id=execution_id,
            instrument_id=instrument_id,
            broker_account_id=broker_account_id,
            quantity=quantity,
            average_price=average_price,
            current_price=current_price,
            market_value=market_value,
            realized_pnl=realized_pnl,
            unrealized_pnl=unrealized_pnl,
            position_status=position_status,
            last_updated_at=last_updated_at,
            closed_at=closed_at,
        )

        self.db.add(position)
        self.db.commit()
        self.db.refresh(position)

        return position

    def list(self) -> list[Position]:
        statement = select(Position).order_by(Position.created_at.desc())
        return list(self.db.scalars(statement).all())

    def get_by_id(
        self,
        *,
        position_id: UUID,
    ) -> Position | None:
        statement = select(Position).where(Position.id == position_id)
        return self.db.scalar(statement)

    def get_by_execution_and_instrument(
        self,
        *,
        execution_id: UUID,
        instrument_id: UUID,
    ) -> Position | None:
        statement = (
            select(Position)
            .where(
                Position.execution_id == execution_id,
                Position.instrument_id == instrument_id,
            )
        )

        return self.db.scalar(statement)

    def update(
        self,
        *,
        position: Position,
        broker_account_id: UUID | None = None,
        quantity: int | None = None,
        average_price=None,
        current_price=None,
        market_value=None,
        realized_pnl=None,
        unrealized_pnl=None,
        position_status=None,
        last_updated_at: datetime | None = None,
        closed_at: datetime | None = None,
    ) -> Position:
        if broker_account_id is not None:
            position.broker_account_id = broker_account_id

        if quantity is not None:
            position.quantity = quantity

        if average_price is not None:
            position.average_price = average_price

        if current_price is not None:
            position.current_price = current_price

        if market_value is not None:
            position.market_value = market_value

        if realized_pnl is not None:
            position.realized_pnl = realized_pnl

        if unrealized_pnl is not None:
            position.unrealized_pnl = unrealized_pnl

        if position_status is not None:
            position.position_status = position_status

        if last_updated_at is not None:
            position.last_updated_at = last_updated_at

        if closed_at is not None:
            position.closed_at = closed_at

        self.db.commit()
        self.db.refresh(position)

        return position

    def delete(
        self,
        *,
        position: Position,
    ) -> None:
        self.db.delete(position)
        self.db.commit()
