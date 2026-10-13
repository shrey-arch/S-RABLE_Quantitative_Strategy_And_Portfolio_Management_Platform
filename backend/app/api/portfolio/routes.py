
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.models import Portfolio, User
from app.schemas.portfolio.requests import (
    CreatePortfolioRequest,
    PortfolioRebalanceRequest,
    PortfolioRiskLimitsInput,
    StrategyCandidateInput,
    TargetPortfolioRequest,
    UpdatePortfolioStateRequest,
)
from app.services.portfolio.orchestrator import PortfolioOrchestrator
from app.services.portfolio.portfolio_persistence_service import (
    PortfolioPersistenceService,
)
from app.services.portfolio.portfolio_state import PortfolioStateService
from app.services.portfolio.risk_service import PortfolioRiskLimits
from app.services.strategies.strategy_selection_service import StrategyCandidate


router = APIRouter(
    prefix="/portfolio",
    tags=["Portfolio"],
)


def _candidates(
    items: list[StrategyCandidateInput],
) -> list[StrategyCandidate]:
    return [
        StrategyCandidate(
            strategy=item.strategy,
            asset=item.asset,
            factors=item.factors,
            weights=item.weights,
            compatible_regimes=(
                tuple(item.compatible_regimes)
                if item.compatible_regimes is not None
                else None
            ),
        )
        for item in items
    ]


def _limits(
    item: PortfolioRiskLimitsInput | None,
) -> PortfolioRiskLimits | None:
    if item is None:
        return None

    return PortfolioRiskLimits(
        cash_reserve=item.cash_reserve,
        max_strategy_weight=item.max_strategy_weight,
        max_asset_weight=item.max_asset_weight,
        max_invested_capital=item.max_invested_capital,
    )


def _target_response(target: Any) -> dict[str, Any]:
    return {
        "capital": str(target.capital),
        "regime": target.regime,
        "invested_capital": str(target.invested_capital),
        "cash_reserve": str(target.cash_reserve),
        "positions": [
            {
                "strategy": position.strategy,
                "asset": position.asset,
                "score": position.score,
                "amount": str(position.amount),
            }
            for position in target.positions
        ],
        "target_values": {
            asset: str(amount)
            for asset, amount in target.target_values().items()
        },
    }


def _rebalance_response(plan: Any) -> dict[str, Any]:
    return {
        "current_state": {
            "cash": str(plan.current_state.cash),
            "invested_value": str(plan.current_state.invested_value),
            "total_equity": str(plan.current_state.total_equity),
            "holdings": [
                {
                    "asset": holding.asset,
                    "quantity": holding.quantity,
                    "price": str(holding.price),
                    "market_value": str(holding.market_value),
                }
                for holding in plan.current_state.holdings
            ],
        },
        "target": _target_response(plan.target),
        "rebalancing": {
            "starting_cash": str(plan.rebalancing.starting_cash),
            "ending_cash": str(plan.rebalancing.ending_cash),
            "target_values": {
                asset: str(amount)
                for asset, amount in plan.rebalancing.target_values.items()
            },
            "trades": [
                {
                    "asset": trade.asset,
                    "side": trade.side,
                    "quantity": trade.quantity,
                    "price": str(trade.price),
                    "value": str(trade.value),
                }
                for trade in plan.rebalancing.trades
            ],
        },
        "simulation_only": True,
    }


def _state_response(state: Any) -> dict[str, Any]:
    return {
        "cash": str(state.cash),
        "invested_value": str(state.invested_value),
        "total_equity": str(state.total_equity),
        "allocation_weights": {
            asset: str(weight)
            for asset, weight in state.allocation_weights().items()
        },
        "holdings": [
            {
                "asset": holding.asset,
                "quantity": holding.quantity,
                "price": str(holding.price),
                "market_value": str(holding.market_value),
            }
            for holding in state.holdings
        ],
        "simulation_only": True,
    }


@router.post("/target")
def calculate_target(
    request: TargetPortfolioRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        target = PortfolioOrchestrator.build_target(
            request.capital,
            _candidates(request.candidates),
            regime=request.regime,
            limits=_limits(request.limits),
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return _target_response(target)


@router.post("/rebalance")
def propose_rebalance(
    request: PortfolioRebalanceRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        plan = PortfolioOrchestrator.build_rebalance(
            _candidates(request.candidates),
            cash=request.cash,
            holdings={
                asset: (holding.quantity, holding.price)
                for asset, holding in request.holdings.items()
            },
            prices=request.prices,
            regime=request.regime,
            limits=_limits(request.limits),
            minimum_trade_value=request.minimum_trade_value,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return _rebalance_response(plan)


@router.post("/accounts", status_code=201)
def create_portfolio(
    request: CreatePortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = request.name.strip()
    if not name:
        raise HTTPException(
            status_code=422,
            detail="Portfolio name cannot be empty.",
        )

    portfolio = Portfolio(
        user_id=current_user.id,
        name=name,
        description=request.description,
        initial_capital=request.initial_capital,
        cash_balance=request.initial_capital,
    )

    try:
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)
    except Exception:
        db.rollback()
        raise

    return {
        "id": str(portfolio.id),
        "name": portfolio.name,
        "description": portfolio.description,
        "initial_capital": str(portfolio.initial_capital),
        "cash": str(portfolio.cash_balance),
        "simulation_only": True,
    }


@router.get("/accounts")
def list_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import select

    portfolios = db.scalars(
        select(Portfolio)
        .where(Portfolio.user_id == current_user.id)
        .order_by(Portfolio.created_at.desc())
    ).all()

    return [
        {
            "id": str(portfolio.id),
            "name": portfolio.name,
            "description": portfolio.description,
            "initial_capital": str(portfolio.initial_capital),
            "cash": str(portfolio.cash_balance),
            "simulation_only": True,
        }
        for portfolio in portfolios
    ]


@router.get("/accounts/{portfolio_id}")
def get_portfolio_state(
    portfolio_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        state = PortfolioPersistenceService.load(
            db,
            portfolio_id,
            current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return _state_response(state)


@router.put("/accounts/{portfolio_id}/state")
def update_portfolio_state(
    portfolio_id: UUID,
    request: UpdatePortfolioStateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        state = PortfolioStateService.create(
            request.cash,
            {
                asset: (holding.quantity, holding.price)
                for asset, holding in request.holdings.items()
            },
        )

        saved = PortfolioPersistenceService.save(
            db,
            portfolio_id,
            current_user.id,
            state,
        )
    except ValueError as exc:
        status_code = (
            404
            if str(exc) == "Portfolio not found."
            else 422
        )
        raise HTTPException(
            status_code=status_code,
            detail=str(exc),
        ) from exc

    return _state_response(saved)
