from uuid import UUID

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import StrategyType
from app.models.base import BaseModelMixin


class Strategy(BaseModelMixin, Base):
    """
    Represents a user-created trading strategy.
    """

    __tablename__ = "strategies"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    strategy_type: Mapped[StrategyType] = mapped_column(
        Enum(StrategyType, name="strategy_type"),
        nullable=False,
    )

    strategy_config: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
    )

    version: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="strategies",
        lazy="selectin",
    )

    executions: Mapped[list["Execution"]] = relationship(
        "Execution",
        back_populates="strategy",
        cascade="all, delete-orphan",
        lazy="selectin",
    )