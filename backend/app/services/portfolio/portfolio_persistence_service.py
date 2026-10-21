from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Portfolio, PortfolioHolding
from app.services.portfolio.portfolio_state import (
    PortfolioState,
    PortfolioStateService,
)


class PortfolioPersistenceService:
    """Persist simulated portfolio cash and holdings in the database."""

    @staticmethod
    def _get_owned_portfolio(
        db: Session,
        portfolio_id: UUID,
        user_id: UUID,
    ) -> Portfolio:
        statement = (
            select(Portfolio)
            .options(selectinload(Portfolio.holdings))
            .where(
                Portfolio.id == portfolio_id,
                Portfolio.user_id == user_id,
            )
        )
        portfolio = db.scalar(statement)

        if portfolio is None:
            # Do not reveal whether another user's portfolio exists.
            raise ValueError("Portfolio not found.")

        return portfolio

    @classmethod
    def load(
        cls,
        db: Session,
        portfolio_id: UUID,
        user_id: UUID,
    ) -> PortfolioState:
        portfolio = cls._get_owned_portfolio(
            db,
            portfolio_id,
            user_id,
        )

        holdings = {
            holding.asset: (
                holding.quantity,
                holding.current_price,
            )
            for holding in portfolio.holdings
            if holding.quantity > 0
        }

        return PortfolioStateService.create(
            portfolio.cash_balance,
            holdings,
        )

    @classmethod
    def save(
        cls,
        db: Session,
        portfolio_id: UUID,
        user_id: UUID,
        state: PortfolioState,
    ) -> PortfolioState:
        # Validate and normalize state before modifying database records.
        normalized = PortfolioStateService.create(
            state.cash,
            {
                holding.asset: (holding.quantity, holding.price)
                for holding in state.holdings
            },
        )

        portfolio = cls._get_owned_portfolio(
            db,
            portfolio_id,
            user_id,
        )

        try:
            portfolio.cash_balance = normalized.cash

            existing = {
                holding.asset: holding
                for holding in portfolio.holdings
            }
            requested_assets = {
                holding.asset for holding in normalized.holdings
            }

            # Remove assets no longer present in the supplied state.
            portfolio.holdings[:] = [
                holding
                for holding in portfolio.holdings
                if holding.asset in requested_assets
            ]

            existing = {
                holding.asset: holding
                for holding in portfolio.holdings
            }

            for item in normalized.holdings:
                if item.quantity == 0:
                    existing_holding = existing.get(item.asset)
                    if existing_holding is not None:
                        portfolio.holdings.remove(existing_holding)
                    continue

                holding = existing.get(item.asset)

                if holding is None:
                    holding = PortfolioHolding(
                        asset=item.asset,
                        quantity=item.quantity,
                        average_price=item.price,
                        current_price=item.price,
                    )
                    portfolio.holdings.append(holding)
                else:
                    if item.quantity > holding.quantity:
                        # A buy: blend the average cost with the new price.
                        bought = item.quantity - holding.quantity
                        holding.average_price = (
                            (
                                Decimal(holding.average_price) * holding.quantity
                                + item.price * bought
                            )
                            / item.quantity
                        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    # A sell keeps the average cost.
                    holding.quantity = item.quantity
                    holding.current_price = item.price

            db.commit()

        except Exception:
            db.rollback()
            raise

        return cls.load(db, portfolio_id, user_id)

    @classmethod
    def snapshot(
        cls,
        db: Session,
        portfolio_id: UUID,
        user_id: UUID,
    ) -> dict:
        """The saved portfolio: its record, its state and each holding's average cost."""
        portfolio = cls._get_owned_portfolio(
            db,
            portfolio_id,
            user_id,
        )
        state = cls.load(db, portfolio_id, user_id)
        return {
            "portfolio": portfolio,
            "state": state,
            "average_prices": {
                holding.asset: Decimal(holding.average_price)
                for holding in portfolio.holdings
            },
        }
