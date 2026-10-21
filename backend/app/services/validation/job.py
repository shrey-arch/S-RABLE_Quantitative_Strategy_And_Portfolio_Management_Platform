"""Runs a validation (Phase 11) in the backtest worker process.

The API stores the request as a VALIDATION execution (PENDING) and starts this
job with the shared executor. The job loads the market data like a backtest,
runs the pipeline stage by stage and stores the report in
execution_metrics["validation"] after every stage, so the page can show the
stages as they finish. A failed stage does not fail the run; a run fails only
when it cannot start (no data, a strategy that cannot be built).
"""

from __future__ import annotations

import copy
import logging
from datetime import datetime
from uuid import UUID

from app.db import SessionLocal
from app.enums import ExecutionStatus, Timeframe
from app.data.loaders import MarketDatasetLoader
from app.exceptions.backtesting_errors import build_backtest_error_payload
from app.services.backtesting.backtest_service import BacktestService
from app.services.executions.execution_service import ExecutionService
from app.strategies.factory import build_strategy, instrument_layout
from app.validation.pipeline import ModelRegimes, ValidationInputs, run_pipeline

logger = logging.getLogger(__name__)


def run_validation_job(
    execution_id: UUID,
    strategy_key: str,
    strategy_config: dict | None,
    start_timestamp: datetime | None,
    end_timestamp: datetime | None,
    quantity: int,
    run_options: dict | None = None,
):
    """Worker entry point (same arguments as a backtest job)."""
    options = run_options or {}
    db = SessionLocal()
    service = ExecutionService(db)
    execution = service.get_required_execution(execution_id=execution_id)
    try:
        if execution.status != ExecutionStatus.PENDING:
            return None
        service.start_execution(execution=execution)

        # Feature 6: a Python strategy's config is {"code", "params"}; the pipeline
        # takes the params as its config and the code separately.
        python_code = None
        config = dict(strategy_config or {})
        if strategy_key == "python":
            python_code = config.get("code") or ""
            config = dict(config.get("params") or {})

        # Fail early, with the strategy's own message, if it cannot be built.
        build_strategy(strategy_key, strategy_config)

        loader = MarketDatasetLoader(db)
        frequency = Timeframe(execution.timeframe)
        dataset = loader.load(
            instrument_id=execution.instrument_id,
            frequency=frequency,
            start_timestamp=start_timestamp,
            end_timestamp=end_timestamp,
        )
        data = dataset.ohlcv
        if data is None or data.empty:
            raise ValueError(
                "No market data for the chosen instrument and dates. "
                "Import historical data for this range first."
            )
        instrument_ids = None
        layout = instrument_layout(strategy_key)
        others = [UUID(str(v)) for v in options.get("other_instrument_ids") or []]
        if layout != "single":
            datasets = [dataset] + [
                loader.load(
                    instrument_id=other,
                    frequency=frequency,
                    start_timestamp=start_timestamp,
                    end_timestamp=end_timestamp,
                )
                for other in others
            ]
            data, instrument_ids = BacktestService.combine_closes(datasets, layout)

        walk_forward = options.get("walk_forward") or {}
        regimes = options.get("regimes") or {}
        monte_carlo = options.get("monte_carlo") or {}
        model_regimes = None
        if regimes.get("source") == "model":
            # Feature 3: the model chosen at submit time; a problem fails stage 3 only.
            from app.services.validation.model_regimes import load_model_regimes

            try:
                model_regimes = load_model_regimes(db, UUID(str(regimes["model_id"])))
            except ValueError as exc:
                model_regimes = ModelRegimes(
                    model=regimes.get("model") or {},
                    labels=[],
                    days={},
                    reference_days=set(),
                    error=str(exc),
                )
        inputs = ValidationInputs(
            data=data,
            strategy_key=strategy_key,
            config=config,
            python_code=python_code,
            instrument_id=execution.instrument_id,
            instrument_ids=instrument_ids,
            initial_capital=float(execution.initial_capital),
            quantity=quantity,
            slippage_bps=float(options.get("slippage_bps") or 0),
            brokerage_rate=float(options.get("brokerage_rate") or 0),
            train_bars=int(walk_forward.get("train_bars", 252)),
            validation_bars=int(walk_forward.get("validation_bars", 63)),
            test_bars=int(walk_forward.get("test_bars", 63)),
            step_bars=walk_forward.get("step_bars"),
            parameter_grid=dict(walk_forward.get("parameter_grid") or {}),
            trend_window=int(regimes.get("trend_window", 200)),
            volatility_window=int(regimes.get("volatility_window", 20)),
            model_regimes=model_regimes,
            simulations=int(monte_carlo.get("simulations", 1000)),
            seed=int(monte_carlo.get("seed", 42)),
        )

        metadata = dataset.metadata if isinstance(dataset.metadata, dict) else {}
        provenance = {
            key: (
                metadata[key].isoformat()
                if hasattr(metadata.get(key), "isoformat")
                else metadata.get(key)
            )
            for key in (
                "provider",
                "data_fingerprint",
                "data_version",
                "dataset_cache_key",
                "row_count",
                "data_acquired_at",
            )
        }

        def store(report: dict) -> None:
            # A new dict every time, so the JSON column is saved.
            execution.execution_metrics = {
                "validation": copy.deepcopy(report),
                "data_provenance": provenance,
                "bars": len(data),
            }
            service.repository.update(execution=execution)

        run_pipeline(inputs, on_progress=store)
        service.complete_execution(execution=execution)
        return None
    except Exception as exc:
        logger.exception("Validation failed: execution_id=%s", execution_id)
        db.rollback()
        try:
            execution = service.get_required_execution(execution_id=execution_id)
            if execution.status in {ExecutionStatus.PENDING, ExecutionStatus.RUNNING}:
                message = str(exc) or type(exc).__name__
                context = (
                    "market_data_unavailable"
                    if "market data" in message.lower() or "dataset" in message.lower()
                    else "strategy_execution"
                )
                service.fail_execution(
                    execution=execution,
                    error_message=message,
                    error_details=build_backtest_error_payload(
                        exc,
                        execution_id=execution_id,
                        stage="validation",
                        context=context,
                    ),
                )
        except Exception:
            logger.exception("Could not store the validation failure: %s", execution_id)
        raise
    finally:
        db.close()
