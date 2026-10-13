from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from app.services.portfolio.allocation_service import PortfolioAllocationService
from app.services.portfolio.portfolio_state import (
    PortfolioState,
    PortfolioStateService,
)
from app.services.portfolio.rebalancing_service import (
    PortfolioRebalancingService,
    RebalanceResult,
)
from app.services.portfolio.risk_service import (
    PortfolioRiskLimits,
    PortfolioRiskService,
    RiskConstraintResult,
)
from app.services.strategies.strategy_selection_service import (
    StrategyCandidate,
    StrategySelection,
    StrategySelectionService,
)


@dataclass(frozen=True)
class TargetPortfolioPosition:
    strategy: str
    asset: str | None
    score: float
    amount: Decimal


@dataclass(frozen=True)
class TargetPortfolio:
    capital: Decimal
    regime: str | None
    positions: tuple[TargetPortfolioPosition, ...]
    risk_result: RiskConstraintResult

    @property
    def invested_capital(self) -> Decimal:
        return self.risk_result.invested_capital

    @property
    def cash_reserve(self) -> Decimal:
        return self.risk_result.cash_reserve

    def target_values(self) -> dict[str, Decimal]:
        values: dict[str, Decimal] = {}

        for position in self.positions:
            if position.asset is None:
                continue
            values[position.asset] = (
                values.get(position.asset, Decimal("0.00"))
                + position.amount
            )

        return values


@dataclass(frozen=True)
class PortfolioRebalancePlan:
    current_state: PortfolioState
    target: TargetPortfolio
    rebalancing: RebalanceResult


class PortfolioOrchestrator:
    """Build target portfolios and simulated rebalancing proposals."""

    @staticmethod
    def build_target(
        capital: Decimal | int | float | str,
        candidates: list[StrategyCandidate],
        *,
        regime: str | None = None,
        limits: PortfolioRiskLimits | None = None,
    ) -> TargetPortfolio:
        selected = StrategySelectionService.select(
            candidates,
            regime=regime,
        )

        if not selected:
            raise ValueError("No eligible strategy opportunities were selected.")

        best_by_strategy: dict[str, StrategySelection] = {}

        for item in selected:
            current = best_by_strategy.get(item.strategy)
            if (
                current is None
                or item.score > current.score
                or (
                    item.score == current.score
                    and (item.asset or "") < (current.asset or "")
                )
            ):
                best_by_strategy[item.strategy] = item

        scores = {
            strategy: item.score
            for strategy, item in best_by_strategy.items()
        }

        proposed = PortfolioAllocationService.allocate(capital, scores)
        amounts = {item.strategy: item.amount for item in proposed}

        risk_result = PortfolioRiskService.constrain(
            capital,
            amounts,
            limits,
            strategy_assets={
                strategy: item.asset
                for strategy, item in best_by_strategy.items()
            },
        )

        constrained_amounts = {
            item.strategy: item.amount
            for item in risk_result.allocations
        }

        positions = tuple(
            TargetPortfolioPosition(
                strategy=strategy,
                asset=best_by_strategy[strategy].asset,
                score=best_by_strategy[strategy].score,
                amount=constrained_amounts[strategy],
            )
            for strategy in sorted(best_by_strategy)
        )

        return TargetPortfolio(
            capital=Decimal(str(capital)).quantize(Decimal("0.01")),
            regime=regime,
            positions=positions,
            risk_result=risk_result,
        )

    @classmethod
    def build_rebalance(
        cls,
        candidates: list[StrategyCandidate],
        *,
        cash: Decimal | int | float | str,
        holdings: dict[str, tuple[int, Decimal | int | float | str]],
        prices: dict[str, Decimal | int | float | str],
        regime: str | None = None,
        limits: PortfolioRiskLimits | None = None,
        minimum_trade_value: Decimal | int | float | str = Decimal("0.00"),
    ) -> PortfolioRebalancePlan:
        state = PortfolioStateService.create(cash, holdings)

        if state.total_equity <= 0:
            raise ValueError("Portfolio total equity must be greater than zero.")

        target = cls.build_target(
            state.total_equity,
            candidates,
            regime=regime,
            limits=limits,
        )

        target_values = target.target_values()

        # A target asset needs a market price for quantity-based rebalancing.
        missing_prices = sorted(
            asset for asset in target_values if asset not in prices
        )
        if missing_prices:
            raise ValueError(
                "Missing prices for target assets: "
                + ", ".join(missing_prices)
            )

        rebalancing = PortfolioRebalancingService.propose(
            state.cash,
            {
                holding.asset: (holding.quantity, holding.price)
                for holding in state.holdings
            },
            target_values,
            prices,
            minimum_trade_value=minimum_trade_value,
        )

        return PortfolioRebalancePlan(
            current_state=state,
            target=target,
            rebalancing=rebalancing,
        )
