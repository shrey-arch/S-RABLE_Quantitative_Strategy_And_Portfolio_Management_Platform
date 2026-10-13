from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Trade


class TradeRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        order_id: UUID,
        broker_trade_id: str | None,
        executed_quantity: int,
        executed_price,
        brokerage,
        total_charges,
        trade_timestamp: datetime | None,
    ) -> Trade:
        trade = Trade(
            order_id=order_id,
            broker_trade_id=broker_trade_id,
            executed_quantity=executed_quantity,
            executed_price=executed_price,
            brokerage=brokerage,
            total_charges=total_charges,
            trade_timestamp=trade_timestamp,
        )

        self.db.add(trade)
        self.db.commit()
        self.db.refresh(trade)

        return trade

    def list(self) -> list[Trade]:
        statement = select(Trade).order_by(Trade.created_at.desc())
        return list(self.db.scalars(statement).all())

    def get_by_id(
        self,
        *,
        trade_id: UUID,
    ) -> Trade | None:
        statement = select(Trade).where(Trade.id == trade_id)
        return self.db.scalar(statement)

    def update(
        self,
        *,
        trade: Trade,
        broker_trade_id: str | None = None,
        executed_quantity: int | None = None,
        executed_price=None,
        brokerage=None,
        total_charges=None,
        trade_timestamp: datetime | None = None,
    ) -> Trade:
        if broker_trade_id is not None:
            trade.broker_trade_id = broker_trade_id

        if executed_quantity is not None:
            trade.executed_quantity = executed_quantity

        if executed_price is not None:
            trade.executed_price = executed_price

        if brokerage is not None:
            trade.brokerage = brokerage

        if total_charges is not None:
            trade.total_charges = total_charges

        if trade_timestamp is not None:
            trade.trade_timestamp = trade_timestamp

        self.db.commit()
        self.db.refresh(trade)

        return trade

    def delete(
        self,
        *,
        trade: Trade,
    ) -> None:
        self.db.delete(trade)
        self.db.commit()
