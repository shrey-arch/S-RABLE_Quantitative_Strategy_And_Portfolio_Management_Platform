from __future__ import annotations

import logging
from dataclasses import dataclass
from threading import Lock
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.executions.routes import _to_response
from app.backtesting.engine import ENGINE_VERSION
from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums.execution_status import ExecutionStatus
from app.enums.execution_type import ExecutionType
from app.enums.strategy_type import StrategyType
from app.exceptions.backtesting_errors import (
    build_backtest_error_payload,
    classify_backtest_error,
)
from app.models import User
from app.schemas.backtesting.create import CreateBacktestRequest
from app.schemas.executions.response import ExecutionResponse
from app.services.backtesting.executor_instance import backtest_executor
from app.services.executions.execution_service import ExecutionService
from app.services.instruments.instrument_service import InstrumentService
from app.services.strategies.strategy_service import StrategyService
from app.sandbox import guard
from app.strategies.factory import PYTHON_KEY, effective_parameters, instrument_layout
from app.strategies.registry import StrategyRegistry
from app.strategies.rule_strategy import RULES_KEY, RuleStrategy


def _code_refused(exc: "guard.CodeRefused") -> HTTPException:
    """A Python strategy the static guard refused: 422 with the structured detail."""
    first = exc.problems[0]
    return HTTPException(
        status_code=422,
        detail={
            "code": "STRATEGY_CODE_ERROR",
            "phase": "check",
            "exception": "CodeRefused",
            "message": str(exc),
            "line": first.line,
            "problems": [{"line": p.line, "message": p.message} for p in exc.problems],
        },
    )


logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/backtests",
    tags=["Backtests"],
)

# The shared executor (also used by POST /executions/{id}/cancel). The module-level
# name is kept so tests can replace it.
_executor = backtest_executor

# Checking capacity and starting the worker happen together, so two quick
# submissions cannot both pass the check.
_submit_lock = Lock()

# Backtests and validations share the one worker.
BUSY_MESSAGE = (
    "Another backtest or validation is running. Wait for it to finish, then submit again."
)


def _unprocessable(message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=message)


def _template_key(strategy) -> str | None:
    config = strategy.strategy_config if isinstance(strategy.strategy_config, dict) else {}
    parameters = config.get("parameters") if isinstance(config.get("parameters"), dict) else {}
    key = parameters.get("template")
    return key if isinstance(key, str) and key else None


def _check_instruments(db: Session, request: CreateBacktestRequest, strategy_key: str, parameters: dict):
    layout = instrument_layout(strategy_key)
    others = len(request.other_instrument_ids)
    if layout == "single" and others:
        name = "A no-code strategy" if strategy_key == RULES_KEY else strategy_key
        raise _unprocessable(f"{name} uses one instrument; remove the others.")
    if layout == "pair" and others != 1:
        raise _unprocessable(
            f"{strategy_key} needs exactly two instruments (A and B)."
        )
    if layout == "universe":
        needed = max(2, int(parameters.get("top_k", 2)))
        if others + 1 < needed:
            raise _unprocessable(
                f"{strategy_key} needs at least {needed} instruments "
                f"(top_k is {parameters.get('top_k', 2)})."
            )

    instruments = InstrumentService(db)
    for instrument_id in [request.instrument_id, *request.other_instrument_ids]:
        instrument = instruments.get_instrument(instrument_id=instrument_id)
        if instrument is None:
            raise _unprocessable(f"Instrument {instrument_id} does not exist.")
        if not instrument.is_active:
            raise _unprocessable(f"{instrument.trading_symbol} is inactive.")


@dataclass
class ResolvedRun:
    """The saved strategy a run uses, and how it will be built."""

    strategy: Any
    strategy_key: str
    rules: dict | None
    parameters: dict
    effective: dict
    # Feature 6: the source of a custom Python strategy (strategy_key == "python").
    python_code: str | None = None


def resolve_strategy_run(
    db: Session, request: CreateBacktestRequest, current_user: User
) -> ResolvedRun:
    """Checks shared by backtests and validations (404 / 422 with the reason)."""
    strategy = StrategyService(db).get_strategy(
        strategy_id=request.strategy_id,
        user_id=current_user.id,
    )
    if strategy is None:
        raise HTTPException(status_code=404, detail="Strategy not found.")
    if not strategy.is_active:
        raise _unprocessable("This strategy is inactive. Turn it on to backtest it.")

    strategy_key = _template_key(strategy)
    rules = None
    python_code = None
    if strategy_key is None and strategy.strategy_type == StrategyType.PYTHON:
        # Feature 6: a custom Python strategy runs in the isolated sandbox.
        strategy_key = PYTHON_KEY
        python_code = strategy.python_code or ""
        try:
            guard.check(python_code)
        except guard.CodeRefused as exc:
            raise _code_refused(exc) from None
    elif strategy_key is None and strategy.strategy_type == StrategyType.NO_CODE:
        # A no-code strategy runs the rules saved in the builder (long only).
        strategy_key = RULES_KEY
        rules = strategy.strategy_config if isinstance(strategy.strategy_config, dict) else {}
    elif strategy_key is None or strategy_key not in StrategyRegistry.available():
        raise _unprocessable(
            "Only strategies made from a core template, built without code, or written "
            "in Python can be backtested."
        )
    if request.strategy_key is not None and request.strategy_key != strategy_key:
        raise _unprocessable(
            f"strategy_key {request.strategy_key!r} does not match the strategy "
            f"({strategy_key!r})."
        )

    parameters = dict(request.execution_config or {})
    if strategy_key == PYTHON_KEY:
        _check_instruments(db, request, strategy_key, {})
        return ResolvedRun(strategy, strategy_key, None, parameters, {}, python_code=python_code)
    if rules is not None:
        try:
            RuleStrategy(rules)
        except ValueError as exc:
            raise _unprocessable(str(exc)) from exc
        if parameters:
            raise _unprocessable(
                "A no-code strategy runs with the rules saved in the builder; it has no "
                "per-run parameters. Edit the strategy to change its rules."
            )
        effective = {}
    else:
        try:
            effective = effective_parameters(strategy_key, parameters)
            StrategyRegistry.get(strategy_key, **parameters)
        except (TypeError, ValueError) as exc:
            raise _unprocessable(str(exc)) from exc

    _check_instruments(db, request, strategy_key, effective)
    return ResolvedRun(strategy, strategy_key, rules, parameters, effective)


def base_run_settings(request: CreateBacktestRequest, resolved: ResolvedRun) -> dict:
    run_settings = {
        "strategy_key": resolved.strategy_key,
        "start_timestamp": request.start_timestamp.isoformat() if request.start_timestamp else None,
        "end_timestamp": request.end_timestamp.isoformat() if request.end_timestamp else None,
        "quantity": request.quantity,
        "other_instrument_ids": [str(i) for i in request.other_instrument_ids],
        "slippage_bps": request.slippage_bps,
        "brokerage_rate": request.brokerage_rate,
        "strategy_version": resolved.strategy.version,
        "engine_version": ENGINE_VERSION,
    }
    if resolved.rules is not None:
        # The rules as they were when the run was submitted (the strategy may change later).
        run_settings["rules"] = resolved.rules
    if resolved.python_code is not None:
        # The code as it was when the run was submitted (the strategy may change later).
        run_settings["python_code"] = resolved.python_code
    return run_settings


def worker_config(resolved: ResolvedRun) -> dict | None:
    """What the worker builds the strategy from (strategy_config passed to submit)."""
    if resolved.python_code is not None:
        return {"code": resolved.python_code, "params": resolved.parameters}
    return resolved.rules if resolved.rules is not None else resolved.parameters


@router.post(
    "",
    response_model=ExecutionResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        409: {"description": "Another backtest is running."},
        422: {"description": "The strategy, parameters or instruments are not valid."},
    },
)
def create_backtest(
    request: CreateBacktestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resolved = resolve_strategy_run(db, request, current_user)
    strategy_key, rules, parameters = resolved.strategy_key, resolved.rules, resolved.parameters

    run_settings = base_run_settings(request, resolved)
    run_options = {
        key: run_settings[key]
        for key in ("other_instrument_ids", "slippage_bps", "brokerage_rate")
        if run_settings[key]
    }

    execution_service = ExecutionService(db)

    with _submit_lock:
        if not _executor.has_capacity():
            raise HTTPException(status_code=409, detail=BUSY_MESSAGE)

        execution = execution_service.create_execution(
            strategy_id=request.strategy_id,
            broker_account_id=None,
            instrument_id=request.instrument_id,
            execution_type=ExecutionType.BACKTEST,
            status=ExecutionStatus.PENDING,
            timeframe=request.timeframe.value,
            initial_capital=request.initial_capital,
            execution_config=parameters,
            run_settings=run_settings,
        )

        try:
            _executor.submit(
                execution_id=execution.id,
                strategy_key=strategy_key,
                strategy_config=worker_config(resolved),
                start_timestamp=request.start_timestamp,
                end_timestamp=request.end_timestamp,
                quantity=request.quantity,
                **({"run_options": run_options} if run_options else {}),
            )
        except Exception as exc:
            classification = classify_backtest_error(
                exc,
                context="worker_submission",
            )
            logger.exception(
                "Backtest submission failed: category=%s code=%s execution_id=%s",
                classification.category,
                classification.code,
                execution.id,
            )

            try:
                execution_service.fail_execution(
                    execution=execution,
                    error_message=str(exc) or type(exc).__name__,
                    error_details=build_backtest_error_payload(
                        exc,
                        execution_id=execution.id,
                        stage="worker_submission",
                        context="worker_submission",
                    ),
                )
            except Exception:
                logger.exception(
                    "Could not persist backtest submission failure: execution_id=%s",
                    execution.id,
                )

            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to submit backtest job.",
            ) from exc

    return _to_response(execution)
