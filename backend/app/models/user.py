from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import AccountStatus
from app.models.base import BaseModelMixin


class User(BaseModelMixin, Base):
    """
    Represents a registered platform user.
    """

    __tablename__ = "users"

    __table_args__ = ()

    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
        nullable=False,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    phone_number: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )

    profile_image_url: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    account_status: Mapped[AccountStatus] = mapped_column(
        Enum(AccountStatus, name="account_status"),
        default=AccountStatus.ACTIVE,
        nullable=False,
    )

    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    broker_accounts: Mapped[list["BrokerAccount"]] = relationship(
        "BrokerAccount",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    strategies: Mapped[list["Strategy"]] = relationship(
        "Strategy",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )