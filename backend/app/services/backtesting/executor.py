from __future__ import annotations

import logging
import multiprocessing
from concurrent.futures import Future
from datetime import datetime
from threading import Lock, Thread
from uuid import UUID

from app.config import settings
from app.db import SessionLocal
from app.enums import ExecutionStatus
from app.exceptions.backtesting_errors import (
    build_backtest_error_payload,
    classify_backtest_error,
)
from app.services.backtesting.job_runner import BacktestJobRunner
from app.services.backtesting.job_logging import append_job_error
from app.services.executions.execution_service import ExecutionService


logger = logging.getLogger(__name__)


def _run_backtest_job(
    execution_id: UUID,
    strategy_key: str,
    strategy_config: dict | None,
    start_timestamp: datetime | None,
    end_timestamp: datetime | None,
    quantity: int,
    run_options: dict | None = None,
):
    runner = BacktestJobRunner()

    # run_options (instruments, costs) is only passed when set, so workers and
    # tests written for the original six arguments keep working.
    extra = {"run_options": run_options} if run_options else {}

    return runner.run(
        execution_id=execution_id,
        strategy_key=strategy_key,
        strategy_config=strategy_config,
        start_timestamp=start_timestamp,
        end_timestamp=end_timestamp,
        quantity=quantity,
        **extra,
    )


def _mark_execution_failed(
    execution_id: UUID,
    error_message: str,
    error_details: dict | None = None,
) -> None:
    db = SessionLocal()

    try:
        execution_service = ExecutionService(db)
        execution = execution_service.get_execution(
            execution_id=execution_id,
        )

        if execution is None:
            return

        if execution.status == ExecutionStatus.RUNNING:
            execution_service.fail_execution(
                execution=execution,
                error_message=error_message,
                error_details=error_details,
            )
    finally:
        db.close()


def _mark_execution_failed_safely(
    execution_id: UUID,
    error_message: str,
    error_details: dict | None = None,
) -> None:
    try:
        _mark_execution_failed(
            execution_id=execution_id,
            error_message=error_message,
            error_details=error_details,
        )
    except Exception:
        logger.exception(
            "Could not persist backtest failure: execution_id=%s",
            execution_id,
        )


def _monitor_process(
    *,
    process: multiprocessing.Process,
    future: Future,
    execution_id: UUID,
    timeout_seconds: int,
    processes: set[multiprocessing.Process],
    process_lock: Lock,
) -> None:
    try:
        process.join(timeout_seconds)

        if process.is_alive():
            timeout_message = (
                f"Backtest execution timed out after "
                f"{timeout_seconds} seconds."
            )

            classification = classify_backtest_error(
                TimeoutError(timeout_message),
            )
            logger.error(
                "Backtest worker timed out: category=%s code=%s "
                "execution_id=%s timeout_seconds=%s",
                classification.category,
                classification.code,
                execution_id,
                timeout_seconds,
            )

            append_job_error(
                execution_id,
                timeout_message,
            )

            process.terminate()
            process.join(timeout=5)

            if process.is_alive():
                process.kill()
                process.join()

            _mark_execution_failed_safely(
                execution_id=execution_id,
                error_message=timeout_message,
                error_details=build_backtest_error_payload(
                    TimeoutError(timeout_message),
                    execution_id=execution_id,
                    stage="worker_monitor",
                    context="timeout",
                ),
            )

            future.set_exception(
                TimeoutError(timeout_message),
            )
            return

        if process.exitcode != 0:
            error_message = (
                f"Backtest worker exited unexpectedly "
                f"with exit code {process.exitcode}."
            )

            classification = classify_backtest_error(
                RuntimeError(error_message),
                context="worker_exit",
            )
            logger.error(
                "Backtest worker exited unexpectedly: category=%s code=%s "
                "execution_id=%s exit_code=%s",
                classification.category,
                classification.code,
                execution_id,
                process.exitcode,
            )

            append_job_error(
                execution_id,
                error_message,
            )

            _mark_execution_failed_safely(
                execution_id=execution_id,
                error_message=error_message,
                error_details=build_backtest_error_payload(
                    RuntimeError(error_message),
                    execution_id=execution_id,
                    stage="worker_monitor",
                    context="worker_exit",
                ),
            )

            future.set_exception(
                RuntimeError(error_message),
            )
            return

        future.set_result(None)

    finally:
        with process_lock:
            processes.discard(process)


class BacktestExecutor:
    """
    Process-per-job executor for backtests.

    Each backtest owns its worker process, allowing the executor
    to enforce both concurrency limits and hard process timeouts.
    """

    def __init__(
        self,
        *,
        max_workers: int = 1,
        timeout_seconds: int | None = None,
    ):
        if max_workers <= 0:
            raise ValueError("max_workers must be greater than 0.")

        if timeout_seconds is None:
            timeout_seconds = settings.backtest_timeout_seconds

        if timeout_seconds <= 0:
            raise ValueError(
                "timeout_seconds must be greater than 0."
            )

        self._max_workers = max_workers
        self._timeout_seconds = timeout_seconds
        self._context = multiprocessing.get_context("spawn")
        self._processes: set[multiprocessing.Process] = set()
        self._by_execution: dict[UUID, multiprocessing.Process] = {}
        self._monitor_threads: set[Thread] = set()
        self._process_lock = Lock()

    def has_capacity(self) -> bool:
        """True when a new backtest can start now."""
        with self._process_lock:
            return len(self._processes) < self._max_workers

    def cancel(self, execution_id: UUID) -> bool:
        """Stop the worker running this execution. Returns True if one was stopped.

        The caller marks the execution CANCELLED first; the worker's own status
        changes then fail (the lifecycle forbids leaving CANCELLED), so a stopped
        or late worker can never overwrite the cancellation.
        """
        with self._process_lock:
            process = self._by_execution.pop(execution_id, None)

        if process is None or not process.is_alive():
            return False

        process.terminate()
        process.join(timeout=5)
        if process.is_alive():
            process.kill()
            process.join()
        return True

    def submit(
        self,
        *,
        execution_id: UUID,
        strategy_key: str,
        strategy_config: dict | None = None,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
        quantity: int = 1,
        worker_target=None,
        run_options: dict | None = None,
        timeout_seconds: int | None = None,
    ) -> Future:
        """Start one job in its own process. timeout_seconds overrides the
        executor's limit for this job (validation runs take longer)."""
        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        future = Future()

        process = self._context.Process(
            target=worker_target or _run_backtest_job,
            args=(
                execution_id,
                strategy_key,
                strategy_config,
                start_timestamp,
                end_timestamp,
                quantity,
            ),
            kwargs={"run_options": run_options} if run_options else {},
        )

        with self._process_lock:
            if len(self._processes) >= self._max_workers:
                raise RuntimeError(
                    "Backtest executor is at capacity."
                )

            self._processes.add(process)
            self._by_execution = {
                key: value
                for key, value in self._by_execution.items()
                if value in self._processes
            }
            self._by_execution[execution_id] = process

        try:
            process.start()
        except Exception as exc:
            with self._process_lock:
                self._processes.discard(process)

            classification = classify_backtest_error(
                exc,
                context="worker_submission",
            )
            logger.exception(
                "Could not start backtest worker: category=%s code=%s "
                "execution_id=%s",
                classification.category,
                classification.code,
                execution_id,
            )
            raise

        monitor = Thread(
            target=_monitor_process,
            kwargs={
                "process": process,
                "future": future,
                "execution_id": execution_id,
                "timeout_seconds": timeout_seconds or self._timeout_seconds,
                "processes": self._processes,
                "process_lock": self._process_lock,
            },
            daemon=True,
        )

        with self._process_lock:
            self._monitor_threads.add(monitor)

        monitor.start()

        return future

    def shutdown(self, *, wait: bool = True):
        with self._process_lock:
            processes = list(self._processes)
            monitor_threads = list(self._monitor_threads)

        if wait:
            for monitor in monitor_threads:
                monitor.join()

            for process in processes:
                process.join()
        else:
            for process in processes:
                if process.is_alive():
                    process.terminate()

            for process in processes:
                process.join(timeout=5)

                if process.is_alive():
                    process.kill()
                    process.join()

            for monitor in monitor_threads:
                monitor.join(timeout=5)

        with self._process_lock:
            self._processes.clear()
            self._monitor_threads = {
                monitor
                for monitor in self._monitor_threads
                if monitor.is_alive()
            }
