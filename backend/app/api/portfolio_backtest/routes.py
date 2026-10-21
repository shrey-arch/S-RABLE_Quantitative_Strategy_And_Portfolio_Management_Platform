"""Portfolio backtest against Nifty 50 (Feature 4, Objective 6).

POST starts a run (an Execution of type PORTFOLIO_BACKTEST) in the backtest
worker; the page follows it with GET /portfolio-backtests/{id} and shows GET
/portfolio-backtests/{id}/results when it has COMPLETED. Cancelling uses
POST /executions/{id}/cancel like any run. Only the owner sees a run.
"""

from __future__ import annotations

import logging
from datetime import datetime, time
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.backtesting import routes as backtest_routes
from app.config import settings
from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import ExecutionStatus, ExecutionType, Timeframe
from app.models import Execution, Instrument, MarketData, User
from app.schemas.portfolio_backtest import (
    CreatePortfolioBacktestRequest,
    PortfolioBacktestDetail,
    PortfolioBacktestResults,
    PortfolioBacktestSummary,
)
from app.services.executions.execution_service import ExecutionService
from app.services.market_data.coverage import today_ist
from app.services.portfolio_backtest import service as pb
from app.services.regime.service import IST
from app.services.validation.model_regimes import model_reference, resolve_model

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/portfolio-backtests", tags=["Portfolio backtest"])

MIN_BENCHMARK_BARS = 20
NOT_FOUND = "Portfolio backtest not found."


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _summary(execution: Execution) -> dict:
    rs = execution.run_settings or {}
    result = (execution.execution_metrics or {}).get("portfolio_backtest")
    headline = None
    if execution.status == ExecutionStatus.COMPLETED and isinstance(result, dict):
        objectives = result["objectives"]
        headline = {
            "portfolio_return": result["metrics"]["portfolio"]["total_return"],
            "nifty_return": result["metrics"]["nifty"]["total_return"],
            "sharpe_met": objectives["sharpe_improvement"]["met"],
            "drawdown_met": objectives["drawdown_reduction"]["met"],
        }
    return {
        "id": execution.id,
        "name": rs.get("name", "Portfolio"),
        "status": execution.status,
        "start_date": rs["start_date"],
        "end_date": rs["end_date"],
        "frequency": rs["frequency"],
        "strategy_count": len(rs.get("strategies") or []),
        "benchmark_symbol": rs.get("benchmark_symbol"),
        "regime_filter": bool(rs.get("regime_filter")),
        "error_message": execution.error_message,
        "created_at": execution.created_at,
        "started_at": execution.started_at,
        "completed_at": execution.completed_at,
        "headline": headline,
    }


def _detail(execution: Execution) -> dict:
    rs = execution.run_settings or {}
    return {
        **_summary(execution),
        "benchmark_instrument_id": rs.get("benchmark_instrument_id"),
        "capital": rs["capital"],
        "brokerage_rate": rs["brokerage_rate"],
        "slippage_bps": rs["slippage_bps"],
        "limits": rs["limits"],
        "sixty_forty": bool(rs.get("sixty_forty")),
        "strategies": rs["strategies"],
        "excluded": rs.get("excluded") or [],
        "regime_model": rs.get("regime_model"),
        "require_validated": bool(rs.get("require_validated")),
        "hindsight": rs.get("hindsight") or [],
    }


def _owned(db: Session, run_id: UUID, user: User) -> Execution:
    execution = ExecutionService(db).get_for_user(execution_id=run_id, user_id=user.id)
    if execution is None or execution.execution_type != ExecutionType.PORTFOLIO_BACKTEST:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return execution


@router.post(
    "",
    response_model=PortfolioBacktestDetail,
    status_code=status.HTTP_201_CREATED,
    responses={
        404: {"description": "A strategy is not yours."},
        409: {"description": "Another backtest or validation is running."},
        422: {"description": "The strategies, benchmark, dates or regime model cannot be used."},
    },
)
def create_portfolio_backtest(
    request: CreatePortfolioBacktestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if request.end_date > today_ist():
        raise _unprocessable("end_date cannot be after today.")
    try:
        usable, excluded = pb.resolve_strategies(
            db, current_user.id, request.strategy_ids, request.require_validated
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not usable:
        raise _unprocessable(
            "None of the chosen strategies can be backtested in a portfolio. "
            + " ".join(f"{e['name']}: {e['reason']}" for e in excluded)
        )

    benchmark = db.get(Instrument, request.benchmark_instrument_id)
    if benchmark is None:
        raise _unprocessable("The benchmark instrument does not exist.")
    first = datetime.combine(request.start_date, time.min, tzinfo=IST)
    last = datetime.combine(request.end_date, time.max, tzinfo=IST)
    bars = int(
        db.scalar(
            select(func.count())
            .select_from(MarketData)
            .where(
                MarketData.instrument_id == benchmark.id,
                MarketData.timeframe == Timeframe.ONE_DAY,
                MarketData.timestamp >= first,
                MarketData.timestamp <= last,
            )
        )
        or 0
    )
    if bars < MIN_BENCHMARK_BARS:
        raise _unprocessable(
            f"{benchmark.symbol} has {bars} daily bars in this period; at least "
            f"{MIN_BENCHMARK_BARS} are needed. Import its data first."
        )

    regime_model = None
    if request.regime_filter:
        try:
            record = resolve_model(db, request.regime_model_id)
        except ValueError as exc:
            raise _unprocessable(f"{exc} Or turn the regime filter off.") from exc
        regime_model = model_reference(db, record)

    run_settings = {
        "name": request.name,
        "start_date": request.start_date.isoformat(),
        "end_date": request.end_date.isoformat(),
        "frequency": request.frequency,
        "capital": request.capital,
        "brokerage_rate": request.brokerage_rate,
        "slippage_bps": request.slippage_bps,
        "limits": request.limits.model_dump(),
        "regime_filter": request.regime_filter,
        "regime_model": regime_model,
        "sixty_forty": request.sixty_forty,
        "require_validated": request.require_validated,
        "hindsight": (
            pb.hindsight_notes(usable, request.start_date) if request.require_validated else []
        ),
        "benchmark_instrument_id": str(benchmark.id),
        "benchmark_symbol": benchmark.symbol,
        "strategies": usable,
        "excluded": excluded,
        "version": pb.VERSION,
    }

    execution_service = ExecutionService(db)
    with backtest_routes._submit_lock:
        executor = backtest_routes._executor
        if not executor.has_capacity():
            raise HTTPException(status_code=409, detail=backtest_routes.BUSY_MESSAGE)
        execution = execution_service.create_execution(
            strategy_id=UUID(usable[0]["strategy_id"]),
            broker_account_id=None,
            instrument_id=benchmark.id,
            execution_type=ExecutionType.PORTFOLIO_BACKTEST,
            status=ExecutionStatus.PENDING,
            timeframe="1D",
            initial_capital=request.capital,
            execution_config=None,
            run_settings=run_settings,
        )
        try:
            executor.submit(
                execution_id=execution.id,
                strategy_key="portfolio",
                strategy_config=None,
                start_timestamp=first,
                end_timestamp=last,
                quantity=1,
                worker_target=pb.run_portfolio_backtest_job,
                timeout_seconds=settings.validation_timeout_seconds,
            )
        except Exception as exc:
            logger.exception("Portfolio backtest submission failed: %s", execution.id)
            try:
                execution_service.fail_execution(
                    execution=execution, error_message=str(exc) or type(exc).__name__
                )
            except Exception:
                logger.exception("Could not store the submission failure: %s", execution.id)
            raise HTTPException(status_code=500, detail="Failed to submit the portfolio backtest.") from exc
    return _detail(execution)


@router.get("", response_model=list[PortfolioBacktestSummary])
def list_portfolio_backtests(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The user's portfolio backtests, newest first."""
    runs = ExecutionService(db).list_for_user(
        user_id=current_user.id, execution_type=ExecutionType.PORTFOLIO_BACKTEST, limit=500
    )
    return [_summary(e) for e in runs]


@router.get("/{run_id}", response_model=PortfolioBacktestDetail)
def get_portfolio_backtest(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _detail(_owned(db, run_id, current_user))


@router.get(
    "/{run_id}/results",
    response_model=PortfolioBacktestResults,
    responses={409: {"description": "The run has not completed."}},
)
def get_portfolio_backtest_results(
    run_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Everything the results page shows, as stored when the run completed."""
    execution = _owned(db, run_id, current_user)
    result = (execution.execution_metrics or {}).get("portfolio_backtest")
    if execution.status != ExecutionStatus.COMPLETED or not isinstance(result, dict):
        raise HTTPException(
            status_code=409,
            detail=f"This portfolio backtest is {execution.status.value.lower()}; results exist once it completes.",
        )
    return result
