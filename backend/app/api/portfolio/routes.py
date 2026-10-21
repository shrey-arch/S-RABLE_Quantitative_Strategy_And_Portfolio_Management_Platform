from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

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
from app.schemas.portfolio.responses import (
    AssetPrice,
    PortfolioAccount,
    PortfolioSummary,
    RebalancePlanResponse,
    TargetPortfolioResponse,
)
from app.services.portfolio import user_portfolio
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

WEIGHT = Decimal("0.000001")


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


def _weight(value: Any, total: Decimal) -> Decimal:
    if total <= 0:
        return Decimal("0")
    return (Decimal(str(value)) / total).quantize(WEIGHT, rounding=ROUND_HALF_UP)


def _target_response(target: Any, about: dict | None = None) -> dict[str, Any]:
    capital = Decimal(str(target.capital))
    strategies = (about or {}).get("strategies", {})
    positions = []
    strategy_weights: dict[str, Decimal] = {}
    asset_weights: dict[str, Decimal] = {}
    for position in target.positions:
        weight = _weight(position.amount, capital)
        strategy_weights[position.strategy] = weight
        if position.asset is not None:
            asset_weights[position.asset] = (
                asset_weights.get(position.asset, Decimal("0")) + weight
            )
        meta = strategies.get(position.strategy, {})
        positions.append(
            {
                "strategy": position.strategy,
                "strategy_id": meta.get("strategy_id"),
                "name": meta.get("name"),
                "strategy_key": meta.get("strategy_key"),
                "asset": position.asset,
                "score": position.score,
                "amount": str(position.amount),
                "weight": str(weight),
                "validation": meta.get("validation"),
            }
        )
    cash_weight = Decimal("1") - sum(strategy_weights.values(), Decimal("0"))

    return {
        "capital": str(target.capital),
        "regime": target.regime,
        "regime_label": (about or {}).get("regime"),
        "invested_capital": str(target.invested_capital),
        "cash_reserve": str(target.cash_reserve),
        "positions": positions,
        "excluded": [
            {**item, "score": item["score"]}
            for item in (about or {}).get("excluded", [])
        ],
        "target_values": {
            asset: str(amount)
            for asset, amount in target.target_values().items()
        },
        "strategy_weights": {k: str(v) for k, v in strategy_weights.items()},
        "asset_weights": {k: str(v) for k, v in asset_weights.items()},
        "cash_weight": str(cash_weight),
        "binding_limits": list(
            getattr(target.risk_result, "binding_limits", ()) or ()
        ),
        "require_validated": (about or {}).get("require_validated"),
        "simulation_only": True,
    }


def _rebalance_response(
    plan: Any,
    about: dict | None = None,
    prices: dict | None = None,
) -> dict[str, Any]:
    response = {
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
        "target": _target_response(plan.target, about),
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
        "assets": [],
        "ending_state": None,
        "prices": [],
        "simulation_only": True,
    }
    if prices is not None:
        assets = user_portfolio.rebalance_assets(plan, prices)
        ending = user_portfolio.ending_state(plan, assets)
        response["assets"] = [
            {k: (str(v) if isinstance(v, Decimal) else v) for k, v in row.items()}
            for row in assets
        ]
        response["ending_state"] = {
            "cash": str(ending["cash"]),
            "invested_value": str(ending["invested_value"]),
            "total_equity": str(ending["total_equity"]),
            "holdings": [
                {**h, "price": str(h["price"])} for h in ending["holdings"]
            ],
        }
    return response


def _summary(portfolio: Any) -> dict[str, Any]:
    holdings = [h for h in (portfolio.holdings or []) if h.quantity > 0]
    invested = sum(
        (
            (Decimal(str(h.current_price)) * h.quantity).quantize(Decimal("0.01"))
            for h in holdings
        ),
        Decimal("0.00"),
    )
    cash = Decimal(str(portfolio.cash_balance))
    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "description": portfolio.description,
        "initial_capital": str(portfolio.initial_capital),
        "cash": str(portfolio.cash_balance),
        "invested_value": str(invested),
        "total_equity": str(cash + invested),
        "holdings_count": len(holdings),
        "simulation_only": True,
    }


def _account_response(snapshot: dict) -> dict[str, Any]:
    portfolio = snapshot["portfolio"]
    state = snapshot["state"]
    averages = snapshot["average_prices"]
    weights = state.allocation_weights()
    cash_weight = (
        Decimal("1") - sum((Decimal(str(w)) for w in weights.values()), Decimal("0"))
        if Decimal(str(state.total_equity)) > 0
        else Decimal("0")
    )
    return {
        "id": portfolio.id,
        "name": portfolio.name,
        "description": portfolio.description,
        "initial_capital": str(portfolio.initial_capital),
        "cash": str(state.cash),
        "invested_value": str(state.invested_value),
        "total_equity": str(state.total_equity),
        "allocation_weights": {
            asset: str(weight) for asset, weight in weights.items()
        },
        "cash_weight": str(cash_weight),
        "holdings": [
            {
                "asset": holding.asset,
                "quantity": holding.quantity,
                "price": str(holding.price),
                "average_price": str(averages.get(holding.asset, holding.price)),
                "market_value": str(holding.market_value),
                "weight": str(weights.get(holding.asset, Decimal("0"))),
            }
            for holding in state.holdings
        ],
        "simulation_only": True,
    }


@router.post("/target", response_model=TargetPortfolioResponse)
def calculate_target(
    request: TargetPortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """A target allocation. Calculation only: nothing is saved, no order is placed."""
    try:
        if request.strategy_ids:
            target, about = user_portfolio.build_user_target(
                db,
                current_user.id,
                request.capital,
                request.strategy_ids,
                regime_code=request.regime,
                limits=_limits(request.limits),
                require_validated=request.require_validated,
            )
            return _target_response(target, about)
        target = PortfolioOrchestrator.build_target(
            request.capital,
            _candidates(request.candidates),
            regime=request.regime,
            limits=_limits(request.limits),
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return _target_response(target)


@router.post("/rebalance", response_model=RebalancePlanResponse)
def propose_rebalance(
    request: PortfolioRebalanceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Simulated trades toward a target. Calculation only: nothing is saved, no order is placed."""
    holdings = {
        asset: (holding.quantity, holding.price)
        for asset, holding in request.holdings.items()
    }
    try:
        if request.strategy_ids:
            state = PortfolioStateService.create(request.cash, holdings)
            if state.total_equity <= 0:
                raise ValueError("Portfolio total equity must be greater than zero.")
            target, about = user_portfolio.build_user_target(
                db,
                current_user.id,
                state.total_equity,
                request.strategy_ids,
                regime_code=request.regime,
                limits=_limits(request.limits),
                require_validated=request.require_validated,
            )
            prices, used = user_portfolio.fill_prices(
                db, target, request.prices, holdings
            )
            plan = PortfolioOrchestrator.plan_rebalance(
                state,
                target,
                prices,
                minimum_trade_value=request.minimum_trade_value,
            )
            response = _rebalance_response(plan, about, prices)
            response["prices"] = [
                {**item, "price": str(item["price"])} for item in used
            ]
            return response
        plan = PortfolioOrchestrator.build_rebalance(
            _candidates(request.candidates),
            cash=request.cash,
            holdings=holdings,
            prices=request.prices,
            regime=request.regime,
            limits=_limits(request.limits),
            minimum_trade_value=request.minimum_trade_value,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return _rebalance_response(plan, None, request.prices)


@router.get("/prices", response_model=list[AssetPrice])
def latest_prices(
    asset: list[str] = Query(default=[], max_length=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Each asset's latest stored daily close (by trading symbol), to prefill prices."""
    return [
        {**item, "price": None if item["price"] is None else str(item["price"])}
        for item in user_portfolio.latest_prices(db, asset)
    ]


@router.post("/accounts", status_code=201, response_model=PortfolioSummary)
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

    return _summary(portfolio)


@router.get("/accounts", response_model=list[PortfolioSummary])
def list_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    portfolios = db.scalars(
        select(Portfolio)
        .options(selectinload(Portfolio.holdings))
        .where(Portfolio.user_id == current_user.id)
        .order_by(Portfolio.created_at.desc())
    ).all()

    return [_summary(portfolio) for portfolio in portfolios]


@router.get("/accounts/{portfolio_id}", response_model=PortfolioAccount)
def get_portfolio_state(
    portfolio_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        snapshot = PortfolioPersistenceService.snapshot(
            db,
            portfolio_id,
            current_user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return _account_response(snapshot)


@router.put("/accounts/{portfolio_id}/state", response_model=PortfolioAccount)
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

        PortfolioPersistenceService.save(
            db,
            portfolio_id,
            current_user.id,
            state,
        )
        snapshot = PortfolioPersistenceService.snapshot(
            db,
            portfolio_id,
            current_user.id,
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

    return _account_response(snapshot)
