"""Stored validation runs for tests (Feature 5): a completed VALIDATION execution
whose report has the given stage statuses, verdict computed by the pipeline."""

from datetime import datetime, timedelta, timezone

from app.enums import ExecutionStatus, ExecutionType
from app.models import Execution, Strategy
from app.validation.pipeline import STAGES, empty_report, overall_verdict

PASSED_1_TO_4 = {key: "PASS" for key in STAGES[:4]}


def add_validation(
    db,
    strategy: Strategy,
    instrument_id,
    *,
    stages: dict | None = None,
    version: int | None = None,
    status: ExecutionStatus = ExecutionStatus.COMPLETED,
    end: str = "2023-06-30T23:59:59+05:30",
    minutes: int = 0,
) -> Execution:
    """A validation of `strategy` (its current version unless `version` is given)."""
    report = empty_report()
    for key, value in (stages if stages is not None else PASSED_1_TO_4).items():
        report["stages"][key]["status"] = value
    report["verdict"] = overall_verdict(report["stages"])
    run = Execution(
        strategy_id=strategy.id,
        instrument_id=instrument_id,
        execution_type=ExecutionType.VALIDATION,
        status=status,
        timeframe="1D",
        initial_capital=100000,
        execution_config={},
        run_settings={
            "strategy_key": "momentum",
            "strategy_version": strategy.version if version is None else version,
            "start_timestamp": "2022-01-03T00:00:00+05:30",
            "end_timestamp": end,
        },
        execution_metrics={"validation": report},
        completed_at=datetime(2026, 10, 2, tzinfo=timezone.utc) + timedelta(minutes=minutes),
    )
    db.add(run)
    db.flush()
    return run
