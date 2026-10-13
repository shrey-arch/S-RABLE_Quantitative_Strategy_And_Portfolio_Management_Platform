from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import ExecutionStatus, ExecutionType
from app.models.base import BaseModelMixin


class Execution(BaseModelMixin, Base):
    """
    Represents a single execution of a trading strategy.
    """

    __tablename__ = "executions"

    strategy_id: Mapped[UUID] = mapped_column(
        ForeignKey("strategies.id", ondelete="CASCADE"),
        nullable=False,
    )

    broker_account_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("broker_accounts.id", ondelete="SET NULL"),
        nullable=True,
    )

    instrument_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("instruments.id", ondelete="SET NULL"),
        nullable=True,
    )

    execution_type: Mapped[ExecutionType] = mapped_column(
        Enum(ExecutionType, name="execution_type"),
        nullable=False,
    )

    status: Mapped[ExecutionStatus] = mapped_column(
        Enum(ExecutionStatus, name="execution_status"),
        nullable=False,
    )

    timeframe: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )

    initial_capital: Mapped[float] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    execution_config: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    execution_metrics: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    error_message: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    strategy: Mapped["Strategy"] = relationship(
        "Strategy",
        back_populates="executions",
        lazy="selectin",
    )

    broker_account: Mapped["BrokerAccount"] = relationship(
        "BrokerAccount",
        back_populates="executions",
        lazy="selectin",
    )

    instrument: Mapped["Instrument"] = relationship(
        "Instrument",
        back_populates="executions",
        lazy="selectin",
    )

    orders: Mapped[list["Order"]] = relationship(
        "Order",
        back_populates="execution",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    positions: Mapped[list["Position"]] = relationship(
        "Position",
        back_populates="execution",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    portfolios: Mapped[list["Portfolio"]] = relationship(
        "Portfolio",
        secondary="portfolio_executions",
        back_populates="executions",
        lazy="selectin",
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        back_populates="execution",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
