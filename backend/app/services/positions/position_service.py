from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.enums import PositionStatus
from app.models import Position
from app.repositories.positions.position_repository import PositionRepository


class PositionService:
    def __init__(self, db: Session):
        self.repository = PositionRepository(db)

    def create_position(
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
        position_status: PositionStatus,
        last_updated_at: datetime,
        closed_at: datetime | None,
    ) -> Position:
        self._validate_numeric_fields(
            quantity=quantity,
            average_price=average_price,
            current_price=current_price,
            market_value=market_value,
            allow_zero_quantity=position_status == PositionStatus.CLOSED,
        )

        self._validate_status_timestamps(
            position_status=position_status,
            closed_at=closed_at,
        )

        return self.repository.create(
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

    def list_positions(self) -> list[Position]:
        return self.repository.list()

    def get_position(
        self,
        *,
        position_id: UUID,
    ) -> Position | None:
        return self.repository.get_by_id(
            position_id=position_id,
        )

    def get_required_position(
        self,
        *,
        position_id: UUID,
    ) -> Position:
        position = self.get_position(
            position_id=position_id,
        )

        if position is None:
            raise ValueError("Position not found.")

        return position

    def get_position_by_execution_and_instrument(
        self,
        *,
        execution_id: UUID,
        instrument_id: UUID,
    ) -> Position | None:
        return self.repository.get_by_execution_and_instrument(
            execution_id=execution_id,
            instrument_id=instrument_id,
        )

    def update_position(
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
        position_status: PositionStatus | None = None,
        last_updated_at: datetime | None = None,
        closed_at: datetime | None = None,
    ) -> Position:
        effective_status = (
            position_status
            if position_status is not None
            else position.position_status
        )

        self._validate_numeric_fields(
            quantity=quantity,
            average_price=average_price,
            current_price=current_price,
            market_value=market_value,
            allow_none=True,
            allow_zero_quantity=effective_status == PositionStatus.CLOSED,
        )

        effective_closed_at = (
            closed_at
            if closed_at is not None
            else position.closed_at
        )

        self._validate_status_timestamps(
            position_status=effective_status,
            closed_at=effective_closed_at,
        )

        return self.repository.update(
            position=position,
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

    def apply_trade_quantity(
        self,
        *,
        position: Position,
        order_side,
        executed_quantity: int,
        executed_price: float,
    ) -> Position:
        if executed_quantity <= 0:
            raise ValueError(
                "Executed quantity must be greater than zero."
            )

        if executed_price <= 0:
            raise ValueError(
                "Executed price must be greater than zero."
            )

        last_updated_at = datetime.now(timezone.utc)

        if order_side == "BUY":
            new_quantity = position.quantity + executed_quantity

            new_average_price = (
                (
                    position.quantity * position.average_price
                    + executed_quantity * executed_price
                )
                / new_quantity
            )

            update_kwargs = {
                "position": position,
                "quantity": new_quantity,
                "average_price": new_average_price,
                "last_updated_at": last_updated_at,
            }

            if position.current_price is not None:
                new_unrealized_pnl = (
                    position.current_price - new_average_price
                ) * new_quantity

                new_market_value = (
                    position.current_price * new_quantity
                )

                update_kwargs["unrealized_pnl"] = new_unrealized_pnl
                update_kwargs["market_value"] = new_market_value

            return self.repository.update(**update_kwargs)

        if order_side == "SELL":
            if executed_quantity > position.quantity:
                raise ValueError(
                    "Sell quantity cannot exceed position quantity."
                )

            realized_pnl_from_trade = (
                executed_price - position.average_price
            ) * executed_quantity

            new_realized_pnl = (
                position.realized_pnl + realized_pnl_from_trade
            )

            new_quantity = position.quantity - executed_quantity

            if new_quantity == 0:
                return self.repository.update(
                    position=position,
                    quantity=0,
                    realized_pnl=new_realized_pnl,
                    unrealized_pnl=0,
                    market_value=0,
                    position_status=PositionStatus.CLOSED,
                    closed_at=last_updated_at,
                    last_updated_at=last_updated_at,
                )

            update_kwargs = {
                "position": position,
                "quantity": new_quantity,
                "realized_pnl": new_realized_pnl,
                "last_updated_at": last_updated_at,
            }

            if position.current_price is not None:
                new_unrealized_pnl = (
                    position.current_price - position.average_price
                ) * new_quantity

                new_market_value = (
                    position.current_price * new_quantity
                )

                update_kwargs["unrealized_pnl"] = new_unrealized_pnl
                update_kwargs["market_value"] = new_market_value

            return self.repository.update(**update_kwargs)

        raise ValueError("Unsupported order side.")

    def delete_position(
        self,
        *,
        position: Position,
    ) -> None:
        return self.repository.delete(
            position=position,
        )

    @staticmethod
    def _validate_numeric_fields(
        *,
        quantity,
        average_price,
        current_price,
        market_value,
        allow_none: bool = False,
        allow_zero_quantity: bool = False,
    ) -> None:
        if quantity is not None:
            if allow_zero_quantity:
                if quantity < 0:
                    raise ValueError("Quantity cannot be negative.")
            elif quantity <= 0:
                raise ValueError("Quantity must be greater than zero.")
        elif not allow_none:
            raise ValueError("Quantity must be greater than zero.")

        if average_price is not None:
            if average_price <= 0:
                raise ValueError(
                    "Average price must be greater than zero."
                )
        elif not allow_none:
            raise ValueError(
                "Average price must be greater than zero."
            )

        if current_price is not None and current_price <= 0:
            raise ValueError(
                "Current price must be greater than zero."
            )

        if market_value is not None and market_value < 0:
            raise ValueError(
                "Market value cannot be negative."
            )

    @staticmethod
    def _validate_status_timestamps(
        *,
        position_status: PositionStatus,
        closed_at: datetime | None,
    ) -> None:
        if (
            position_status == PositionStatus.OPEN
            and closed_at is not None
        ):
            raise ValueError(
                "Open position cannot have a closed timestamp."
            )

        if (
            position_status == PositionStatus.CLOSED
            and closed_at is None
        ):
            raise ValueError(
                "Closed position must have a closed timestamp."
            )
