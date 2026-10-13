from sqlalchemy import Boolean, Enum, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import Exchange, InstrumentType
from app.models.base import BaseModelMixin


class Instrument(BaseModelMixin, Base):
    """
    Represents a tradeable financial instrument.
    """

    __tablename__ = "instruments"

    symbol: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    trading_symbol: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        index=True,
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    exchange: Mapped[Exchange] = mapped_column(
        Enum(Exchange, name="exchange"),
        nullable=False,
    )

    instrument_type: Mapped[InstrumentType] = mapped_column(
        Enum(InstrumentType, name="instrument_type"),
        nullable=False,
    )

    isin: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    lot_size: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    tick_size: Mapped[float] = mapped_column(
        Float,
        default=0.05,
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    executions: Mapped[list["Execution"]] = relationship(
        "Execution",
        back_populates="instrument",
        lazy="selectin",
    )

    orders: Mapped[list["Order"]] = relationship(
        "Order",
        back_populates="instrument",
        lazy="selectin",
    )

    positions: Mapped[list["Position"]] = relationship(
        "Position",
        back_populates="instrument",
        lazy="selectin",
    )

    market_data: Mapped[list["MarketData"]] = relationship(
        "MarketData",
        back_populates="instrument",
        lazy="selectin",
    )
