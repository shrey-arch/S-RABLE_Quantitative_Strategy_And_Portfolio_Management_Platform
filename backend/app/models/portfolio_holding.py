from decimal import Decimal
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import BaseModelMixin


class PortfolioHolding(BaseModelMixin, Base):
    """A simulated holding owned by a portfolio, independent of broker positions."""

    __tablename__ = "portfolio_holdings"

    __table_args__ = (
        UniqueConstraint(
            "portfolio_id",
            "asset",
            name="uq_portfolio_holding_asset",
        ),
        CheckConstraint(
            "quantity >= 0",
            name="ck_portfolio_holding_quantity_nonnegative",
        ),
        CheckConstraint(
            "average_price >= 0",
            name="ck_portfolio_holding_average_price_nonnegative",
        ),
        CheckConstraint(
            "current_price >= 0",
            name="ck_portfolio_holding_current_price_nonnegative",
        ),
    )

    portfolio_id: Mapped[UUID] = mapped_column(
        ForeignKey("portfolios.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    asset: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    quantity: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    average_price: Mapped[Decimal] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    current_price: Mapped[Decimal] = mapped_column(
        Numeric(18, 2),
        nullable=False,
    )

    portfolio: Mapped["Portfolio"] = relationship(
        "Portfolio",
        back_populates="holdings",
    )
