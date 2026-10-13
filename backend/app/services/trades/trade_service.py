from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import Trade
from app.repositories.trades.trade_repository import TradeRepository
from app.services.orders.order_service import OrderService
from app.services.positions.position_service import PositionService


class TradeService:
    def __init__(self, db: Session):
        self.repository = TradeRepository(db)
        self.order_service = OrderService(db)
        self.position_service = PositionService(db)

    def create_trade(
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
        self._validate_numeric_fields(
            executed_quantity=executed_quantity,
            executed_price=executed_price,
            brokerage=brokerage,
            total_charges=total_charges,
        )

        return self.repository.create(
            order_id=order_id,
            broker_trade_id=broker_trade_id,
            executed_quantity=executed_quantity,
            executed_price=executed_price,
            brokerage=brokerage,
            total_charges=total_charges,
            trade_timestamp=trade_timestamp,
        )

    def execute_trade(
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
        trade = self.create_trade(
            order_id=order_id,
            broker_trade_id=broker_trade_id,
            executed_quantity=executed_quantity,
            executed_price=executed_price,
            brokerage=brokerage,
            total_charges=total_charges,
            trade_timestamp=trade_timestamp,
        )

        order = self.order_service.get_required_order(
            order_id=order_id,
        )

        position = self.position_service.get_position_by_execution_and_instrument(
            execution_id=order.execution_id,
            instrument_id=order.instrument_id,
        )

        if position is None:
            raise ValueError("Position not found.")

        self.position_service.apply_trade_quantity(
            position=position,
            order_side=order.order_side,
            executed_quantity=executed_quantity,
            executed_price=executed_price,
        )

        return trade

    def list_trades(self) -> list[Trade]:
        return self.repository.list()

    def get_trade(
        self,
        *,
        trade_id: UUID,
    ) -> Trade | None:
        return self.repository.get_by_id(
            trade_id=trade_id,
        )

    def get_required_trade(
        self,
        *,
        trade_id: UUID,
    ) -> Trade:
        trade = self.get_trade(
            trade_id=trade_id,
        )

        if trade is None:
            raise ValueError("Trade not found.")

        return trade

    def update_trade(
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
        self._validate_numeric_fields(
            executed_quantity=executed_quantity,
            executed_price=executed_price,
            brokerage=brokerage,
            total_charges=total_charges,
            allow_none=True,
        )

        return self.repository.update(
            trade=trade,
            broker_trade_id=broker_trade_id,
            executed_quantity=executed_quantity,
            executed_price=executed_price,
            brokerage=brokerage,
            total_charges=total_charges,
            trade_timestamp=trade_timestamp,
        )

    def delete_trade(
        self,
        *,
        trade: Trade,
    ) -> None:
        return self.repository.delete(
            trade=trade,
        )

    @staticmethod
    def _validate_numeric_fields(
        *,
        executed_quantity,
        executed_price,
        brokerage,
        total_charges,
        allow_none: bool = False,
    ) -> None:
        if executed_quantity is not None:
            if executed_quantity <= 0:
                raise ValueError(
                    "Executed quantity must be greater than zero."
                )
        elif not allow_none:
            raise ValueError(
                "Executed quantity must be greater than zero."
            )

        if executed_price is not None:
            if executed_price <= 0:
                raise ValueError(
                    "Executed price must be greater than zero."
                )
        elif not allow_none:
            raise ValueError(
                "Executed price must be greater than zero."
            )

        if brokerage is not None:
            if brokerage < 0:
                raise ValueError(
                    "Brokerage cannot be negative."
                )
        elif not allow_none:
            raise ValueError(
                "Brokerage cannot be negative."
            )

        if total_charges is not None:
            if total_charges < 0:
                raise ValueError(
                    "Total charges cannot be negative."
                )
        elif not allow_none:
            raise ValueError(
                "Total charges cannot be negative."
            )
