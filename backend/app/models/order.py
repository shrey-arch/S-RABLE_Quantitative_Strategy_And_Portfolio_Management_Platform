from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import OrderSide, OrderStatus, OrderType
from app.models.base import BaseModelMixin


class Order(BaseModelMixin, Base):
    """
    Represents an order generated during a strategy execution.
    """

    __tablename__ = "orders"

    execution_id: Mapped[UUID] = mapped_column(
        ForeignKey("executions.id", ondelete="CASCADE"),
        nullable=False,
    )

    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id"),
        nullable=False,
    )

    broker_order_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    order_type: Mapped[OrderType] = mapped_column(
        Enum(OrderType, name="order_type"),
        nullable=False,
    )

    order_side: Mapped[OrderSide] = mapped_column(
        Enum(OrderSide, name="order_side"),
        nullable=False,
    )

    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="order_status"),
        nullable=False,
    )

    quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    filled_quantity: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    price: Mapped[float] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    average_fill_price: Mapped[float | None] = mapped_column(
        Numeric(18, 2),
        nullable=True,
    )

    order_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    execution: Mapped["Execution"] = relationship(
        "Execution",
        back_populates="orders",
        lazy="selectin",
    )

    instrument: Mapped["Instrument"] = relationship(
        "Instrument",
        back_populates="orders",
        lazy="selectin",
    )

    trades: Mapped[list["Trade"]] = relationship(
        "Trade",
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )