from datetime import datetime
from uuid import UUID

from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
)

from app.db import Base
from app.enums import BrokerName, ConnectionStatus
from app.models.base import BaseModelMixin


class BrokerAccount(BaseModelMixin, Base):
    """
    Represents a broker account connected by a user.
    """

    __tablename__ = "broker_accounts"

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "broker_name",
            "broker_user_id",
            name="uq_broker_account_user_broker_user",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    broker_name: Mapped[BrokerName] = mapped_column(
        Enum(BrokerName, name="broker_name"),
        nullable=False,
    )

    broker_user_id: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    account_alias: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    api_key: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    api_secret: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    access_token: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    refresh_token: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    connection_status: Mapped[ConnectionStatus] = mapped_column(
        Enum(ConnectionStatus, name="connection_status"),
        default=ConnectionStatus.DISCONNECTED,
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    last_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="broker_accounts",
        lazy="selectin",
    )

    executions: Mapped[list["Execution"]] = relationship(
        "Execution",
        back_populates="broker_account",
        lazy="selectin",
    )

    positions: Mapped[list["Position"]] = relationship(
        "Position",
        back_populates="broker_account",
        lazy="selectin",
    )