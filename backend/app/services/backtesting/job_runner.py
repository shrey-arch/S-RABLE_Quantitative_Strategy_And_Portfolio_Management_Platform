
from __future__ import annotations

import logging
from unittest.mock import Mock
from datetime import datetime
from uuid import UUID

from app.backtesting.broker import SimulatedBroker
from app.db import SessionLocal
from app.exceptions.backtesting_errors import classify_backtest_error
from app.services.backtesting.artifact_manager import BacktestArtifactManager
from app.services.backtesting.backtest_service import BacktestService
from app.services.backtesting.job_logging import (
    close_job_logging,
    configure_job_logging,
)
from app.strategies.factory import (
    build_strategy,
    effective_parameters as strategy_parameters,
    instrument_layout,
)


logger = logging.getLogger(__name__)


class BacktestJobRunner:
    """
    Runs a backtest outside the request-scoped database session.

    The runner creates and owns its own SQLAlchemy session for the
    complete lifetime of the background execution.
    """

    def run(
        self,
        *,
        execution_id: UUID,
        strategy_key: str,
        strategy_config: dict | None = None,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
        quantity: int = 1,
        run_options: dict | None = None,
    ):
        options = run_options or {}
        log_dir, job_logger = configure_job_logging(execution_id)
        job_logger.info(
            "Backtest job logging initialized: execution_id=%s log_dir=%s",
            execution_id,
            log_dir,
        )

        db = SessionLocal()
        artifact_manager = BacktestArtifactManager(execution_id)

        try:
            logger.info(
                "Starting backtest worker: execution_id=%s strategy_key=%s",
                execution_id,
                strategy_key,
            )

            try:
                strategy = build_strategy(strategy_key, strategy_config)
            except Exception as exc:
                classification = classify_backtest_error(
                    exc,
                    context="strategy_lookup",
                )
                logger.exception(
                    "Backtest strategy lookup failed: category=%s code=%s "
                    "execution_id=%s strategy_key=%s",
                    classification.category,
                    classification.code,
                    execution_id,
                    strategy_key,
                )
                raise

            execution_service = BacktestService(db)
            execution = (
                execution_service.execution_service.get_required_execution(
                    execution_id=execution_id,
                )
            )

            # Unit tests may provide MagicMock execution records. Do not
            # serialize mocks as if they were persisted execution data.
            if not isinstance(execution, Mock):
                artifact_manager.initialize(
                    request={
                        "execution_id": str(execution.id),
                        "strategy_id": str(execution.strategy_id),
                        "strategy_key": strategy_key,
                        "instrument_id": (
                            str(execution.instrument_id)
                            if execution.instrument_id
                            else None
                        ),
                        "timeframe": execution.timeframe,
                        "initial_capital": float(execution.initial_capital),
                        "start_timestamp": (
                            start_timestamp.isoformat()
                            if start_timestamp
                            else None
                        ),
                        "end_timestamp": (
                            end_timestamp.isoformat()
                            if end_timestamp
                            else None
                        ),
                        "quantity": quantity,
                    },
                    config=execution.execution_config or strategy_config or {},
                    status=execution.status.value,
                )

                effective_parameters = strategy_parameters(
                    strategy_key, strategy_config
                )
                artifact_manager.write_reproducibility_manifest(
                    {
                        "schema_version": 1,
                        "engine": {
                            "implementation": (
                                "app.backtesting.engine.BacktestEngine"
                            ),
                        },
                        "strategy": {
                            "key": strategy_key,
                            "implementation": (
                                f"{type(strategy).__module__}."
                                f"{type(strategy).__qualname__}"
                            ),
                            "parameters": effective_parameters,
                        },
                        "execution": {
                            "execution_id": str(execution.id),
                            "strategy_id": str(execution.strategy_id),
                            "instrument_id": (
                                str(execution.instrument_id)
                                if execution.instrument_id
                                else None
                            ),
                            "timeframe": execution.timeframe,
                            "initial_capital": float(
                                execution.initial_capital
                            ),
                            "start_timestamp": (
                                start_timestamp.isoformat()
                                if start_timestamp
                                else None
                            ),
                            "end_timestamp": (
                                end_timestamp.isoformat()
                                if end_timestamp
                                else None
                            ),
                            "quantity": quantity,
                            "config": (
                                execution.execution_config
                                or strategy_config
                                or {}
                            ),
                        },
                    }
                )

            extra = {}
            if options.get("other_instrument_ids"):
                extra["other_instrument_ids"] = [
                    UUID(str(value)) for value in options["other_instrument_ids"]
                ]
                extra["instrument_layout"] = instrument_layout(strategy_key)
            if options.get("slippage_bps") or options.get("brokerage_rate"):
                extra["broker"] = SimulatedBroker(
                    slippage_bps=float(options.get("slippage_bps") or 0),
                    brokerage_rate=float(options.get("brokerage_rate") or 0),
                )

            return execution_service.run(
                execution=execution,
                strategy=strategy,
                start_timestamp=start_timestamp,
                end_timestamp=end_timestamp,
                quantity=quantity,
                strategy_key=strategy_key,
                **extra,
            )

        except Exception:
            job_logger.exception(
                "Backtest worker failed: execution_id=%s strategy_key=%s",
                execution_id,
                strategy_key,
            )
            raise

        finally:
            try:
                db.close()
            finally:
                close_job_logging(job_logger)
