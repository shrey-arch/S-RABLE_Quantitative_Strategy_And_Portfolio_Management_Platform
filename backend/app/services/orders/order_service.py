from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.enums import OrderStatus
from app.models import Order
from app.orders.lifecycle import can_transition
from app.repositories.orders.order_repository import OrderRepository


class OrderService:
    def __init__(self, db: Session):
        self.repository = OrderRepository(db)

    def create_order(
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
        if status is not OrderStatus.PENDING:
            raise ValueError("Order must be created with PENDING status.")

        self._validate_numeric_fields(
            quantity=quantity,
            filled_quantity=filled_quantity,
            price=price,
            average_fill_price=average_fill_price,
        )

        return self.repository.create(
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

    def list_orders(self) -> list[Order]:
        return self.repository.list()

    def get_order(
        self,
        *,
        order_id: UUID,
    ) -> Order | None:
        return self.repository.get_by_id(
            order_id=order_id,
        )

    def get_required_order(
        self,
        *,
        order_id: UUID,
    ) -> Order:
        order = self.get_order(
            order_id=order_id,
        )

        if order is None:
            raise ValueError("Order not found.")

        return order

    def update_order(
        self,
        *,
        order: Order,
        broker_order_id: str | None = None,
        status=None,
        filled_quantity: int | None = None,
        average_fill_price=None,
        order_timestamp=None,
    ) -> Order:
        if filled_quantity is not None and filled_quantity < 0:
            raise ValueError("Filled quantity cannot be negative.")

        if average_fill_price is not None and average_fill_price <= 0:
            raise ValueError("Average fill price must be greater than zero.")

        return self.repository.update(
            order=order,
            broker_order_id=broker_order_id,
            status=status,
            filled_quantity=filled_quantity,
            average_fill_price=average_fill_price,
            order_timestamp=order_timestamp,
        )

    def transition_order(
        self,
        *,
        order: Order,
        target_status: OrderStatus,
    ) -> Order:
        if not can_transition(
            order.status,
            target_status,
        ):
            raise ValueError(
                f"Invalid order transition: "
                f"{order.status.value} -> {target_status.value}."
            )

        return self.repository.update(
            order=order,
            status=target_status,
            order_timestamp=datetime.now(timezone.utc),
        )

    def open_order(
        self,
        *,
        order: Order,
    ) -> Order:
        return self.transition_order(
            order=order,
            target_status=OrderStatus.OPEN,
        )

    def complete_order(
        self,
        *,
        order: Order,
    ) -> Order:
        return self.transition_order(
            order=order,
            target_status=OrderStatus.COMPLETED,
        )

    def cancel_order(
        self,
        *,
        order: Order,
    ) -> Order:
        return self.transition_order(
            order=order,
            target_status=OrderStatus.CANCELLED,
        )

    def reject_order(
        self,
        *,
        order: Order,
    ) -> Order:
        return self.transition_order(
            order=order,
            target_status=OrderStatus.REJECTED,
        )

    def delete_order(
        self,
        *,
        order: Order,
    ) -> None:
        return self.repository.delete(
            order=order,
        )

    @staticmethod
    def _validate_numeric_fields(
        *,
        quantity: int,
        filled_quantity: int,
        price,
        average_fill_price,
    ) -> None:
        if quantity <= 0:
            raise ValueError("Quantity must be greater than zero.")

        if filled_quantity < 0:
            raise ValueError("Filled quantity cannot be negative.")

        if price <= 0:
            raise ValueError("Price must be greater than zero.")

        if average_fill_price is not None and average_fill_price <= 0:
            raise ValueError("Average fill price must be greater than zero.")
