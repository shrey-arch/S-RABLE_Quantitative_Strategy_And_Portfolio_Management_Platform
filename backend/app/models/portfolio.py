from decimal import Decimal
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Numeric,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import BaseModelMixin


portfolio_executions = Table(
    "portfolio_executions",
    Base.metadata,
    Column(
        "portfolio_id",
        ForeignKey("portfolios.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "execution_id",
        ForeignKey("executions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Portfolio(BaseModelMixin, Base):
    """A user-owned portfolio grouping multiple strategy executions."""

    __tablename__ = "portfolios"

    __table_args__ = (
        CheckConstraint(
            "initial_capital > 0",
            name="ck_portfolio_initial_capital_positive",
        ),
        CheckConstraint(
            "cash_balance >= 0",
            name="ck_portfolio_cash_balance_nonnegative",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    initial_capital: Mapped[Decimal] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    cash_balance: Mapped[Decimal] = mapped_column(
        Numeric(18, 2),
        nullable=False,
        default=Decimal("0.00"),
    )

    holdings: Mapped[list["PortfolioHolding"]] = relationship(
        "PortfolioHolding",
        back_populates="portfolio",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="portfolios",
        lazy="selectin",
    )

    executions: Mapped[list["Execution"]] = relationship(
        "Execution",
        secondary=portfolio_executions,
        back_populates="portfolios",
        lazy="selectin",
    )
