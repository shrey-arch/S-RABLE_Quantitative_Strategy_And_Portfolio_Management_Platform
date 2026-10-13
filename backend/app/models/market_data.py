from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import Timeframe
from app.models.base import BaseModelMixin


class MarketData(BaseModelMixin, Base):
    """
    Historical OHLCV market-data record for an instrument.
    """

    __tablename__ = "market_data"

    instrument_id: Mapped[UUID] = mapped_column(
        ForeignKey("instruments.id"),
        nullable=False,
    )

    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    timeframe: Mapped[Timeframe] = mapped_column(
        Enum(Timeframe, name="timeframe"),
        nullable=False,
    )

    open: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    high: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    low: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    close: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    volume: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    instrument: Mapped["Instrument"] = relationship(
        "Instrument",
        back_populates="market_data",
        lazy="selectin",
    )
