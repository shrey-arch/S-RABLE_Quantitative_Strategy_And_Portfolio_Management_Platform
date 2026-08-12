from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import PositionStatus
from app.models.base import BaseModelMixin


class Position(BaseModelMixin, Base):
    """
    Represents the current position of an instrument during an execution.
    """

    __tablename__ = "positions"

    execution_id: Mapped[UUID] = mapped_column(
        ForeignKey("executions.id", ondelete="CASCADE"),
        nullable=False,
    )

    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id"),
        nullable=False,
    )

    broker_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("broker_accounts.id"),
        nullable=True,
    )

    quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    average_price: Mapped[float] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    current_price: Mapped[float | None] = mapped_column(
        Numeric(18, 2),
        nullable=True,
    )

    market_value: Mapped[float | None] = mapped_column(
        Numeric(18, 2),
        nullable=True,
    )

    realized_pnl: Mapped[float] = mapped_column(
        Numeric(18, 2),
        default=0,
        nullable=False,
    )

    unrealized_pnl: Mapped[float] = mapped_column(
        Numeric(18, 2),
        default=0,
        nullable=False,
    )

    position_status: Mapped[PositionStatus] = mapped_column(
        Enum(PositionStatus, name="position_status"),
        default=PositionStatus.OPEN,
        nullable=False,
    )

    last_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    execution: Mapped["Execution"] = relationship(
        "Execution",
        back_populates="positions",
        lazy="selectin",
    )

    instrument: Mapped["Instrument"] = relationship(
        "Instrument",
        back_populates="positions",
        lazy="selectin",
    )

    broker_account: Mapped["BrokerAccount"] = relationship(
        "BrokerAccount",
        back_populates="positions",
        lazy="selectin",
    )