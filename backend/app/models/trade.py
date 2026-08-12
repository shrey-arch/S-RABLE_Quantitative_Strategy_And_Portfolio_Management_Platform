from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import BaseModelMixin


class Trade(BaseModelMixin, Base):
    """
    Represents an executed trade (fill) for an order.
    """

    __tablename__ = "trades"

    order_id: Mapped[UUID] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
    )

    broker_trade_id: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    executed_quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    executed_price: Mapped[float] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    brokerage: Mapped[float] = mapped_column(
        Numeric(18, 2),
        default=0,
        nullable=False,
    )

    total_charges: Mapped[float] = mapped_column(
        Numeric(18, 2),
        default=0,
        nullable=False,
    )

    trade_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    order: Mapped["Order"] = relationship(
        "Order",
        back_populates="trades",
        lazy="selectin",
    )