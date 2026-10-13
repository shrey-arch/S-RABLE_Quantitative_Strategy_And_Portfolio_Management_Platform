from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Order


class OrderRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        *,
        execution_id: UUID,
        instrument_id: UUID,
        broker_order_id: str | None,
        order_type,
        order_side,
        status,
        quantity: int,
        filled_quantity: int,
        price,
        average_fill_price,
        order_timestamp,
    ) -> Order:
        order = Order(
            execution_id=execution_id,
            instrument_id=instrument_id,
            broker_order_id=broker_order_id,
            order_type=order_type,
            order_side=order_side,
            status=status,
            quantity=quantity,
            filled_quantity=filled_quantity,
            price=price,
            average_fill_price=average_fill_price,
            order_timestamp=order_timestamp,
        )

        self.db.add(order)
        self.db.commit()
        self.db.refresh(order)

        return order

    def list(self) -> list[Order]:
        statement = (
            select(Order)
            .order_by(Order.created_at.desc())
        )

        return list(self.db.scalars(statement).all())

    def get_by_id(
        self,
        *,
        order_id: UUID,
    ) -> Order | None:
        statement = (
            select(Order)
            .where(Order.id == order_id)
        )

        return self.db.scalar(statement)

    def update(
        self,
        *,
        order: Order,
        broker_order_id: str | None = None,
        status=None,
        filled_quantity: int | None = None,
        average_fill_price=None,
        order_timestamp=None,
    ) -> Order:
        if broker_order_id is not None:
            order.broker_order_id = broker_order_id

        if status is not None:
            order.status = status

        if filled_quantity is not None:
            order.filled_quantity = filled_quantity

        if average_fill_price is not None:
            order.average_fill_price = average_fill_price

        if order_timestamp is not None:
            order.order_timestamp = order_timestamp

        self.db.commit()
        self.db.refresh(order)

        return order

    def delete(
        self,
        *,
        order: Order,
    ) -> None:
        self.db.delete(order)
        self.db.commit()
