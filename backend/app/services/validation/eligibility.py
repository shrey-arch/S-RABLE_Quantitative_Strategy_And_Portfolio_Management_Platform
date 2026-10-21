"""Feature 5: which strategies may receive capital - those that passed validation.

A strategy's validation status comes from its latest COMPLETED validation run
(cancelled or failed runs never replace an earlier result):

- NOT_VALIDATED            no completed validation yet;
- OUTDATED                 the validation was of another version of the strategy
                           (its rules or parameters changed since);
- VALIDATED                all five stages passed, including paper trading;
- VALIDATED_PAPER_PENDING  stages 1 to 4 passed; paper trading (stage 5) has not
                           finished;
- FAILED                   the validation did not pass (or could not finish).

VALIDATED and VALIDATED_PAPER_PENDING are eligible for capital. Validations do
not expire: only a new version of the strategy makes one outdated.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date
from uuid import UUID

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import ExecutionStatus, ExecutionType
from app.models import Execution, Strategy
from app.validation.pipeline import empty_report, normalize_paper_stage

VALIDATED = "VALIDATED"
PAPER_PENDING = "VALIDATED_PAPER_PENDING"
FAILED = "FAILED"
OUTDATED = "OUTDATED"
NOT_VALIDATED = "NOT_VALIDATED"
STATUSES = (VALIDATED, PAPER_PENDING, FAILED, OUTDATED, NOT_VALIDATED)
ELIGIBLE = frozenset({VALIDATED, PAPER_PENDING})

NOT_VALIDATED_REASON = "Not validated yet. Validate it to make it eligible for capital."


def report_of(execution: Execution) -> dict:
    """The validation report of a run as GET /validations/{id} shows it."""
    metrics = execution.execution_metrics if isinstance(execution.execution_metrics, dict) else {}
    report = metrics.get("validation") if isinstance(metrics.get("validation"), dict) else None
    if report is None:
        report = empty_report()
        if execution.status == ExecutionStatus.FAILED:
            report["verdict"] = {
                "status": "INCOMPLETE",
                "reason": "The validation could not run: " + (execution.error_message or "unknown error."),
            }
        elif execution.status == ExecutionStatus.CANCELLED:
            report["verdict"] = {"status": "INCOMPLETE", "reason": "The validation was cancelled."}
    elif execution.status == ExecutionStatus.CANCELLED and report["verdict"]["status"] == "PENDING":
        report["verdict"] = {"status": "INCOMPLETE", "reason": "The validation was cancelled."}
    elif execution.status == ExecutionStatus.FAILED and report["verdict"]["status"] == "PENDING":
        report["verdict"] = {
            "status": "INCOMPLETE",
            "reason": "The validation stopped: " + (execution.error_message or "unknown error."),
        }
    return normalize_paper_stage(report)


def _day(value) -> str | None:
    if not value:
        return None
    stamp = pd.Timestamp(value)
    if stamp.tzinfo is None:
        stamp = stamp.tz_localize("UTC")
    return stamp.tz_convert("Asia/Kolkata").date().isoformat()


def latest_validations(db: Session, strategy_ids: Iterable[UUID]) -> dict[UUID, Execution]:
    """The latest completed validation run of each strategy."""
    ids = list(strategy_ids)
    if not ids:
        return {}
    runs = db.scalars(
        select(Execution)
        .where(
            Execution.strategy_id.in_(ids),
            Execution.execution_type == ExecutionType.VALIDATION,
            Execution.status == ExecutionStatus.COMPLETED,
        )
        .order_by(Execution.completed_at.desc(), Execution.created_at.desc())
    ).all()
    latest: dict[UUID, Execution] = {}
    for run in runs:
        latest.setdefault(run.strategy_id, run)
    return latest


def status_from(strategy: Strategy, run: Execution | None) -> dict:
    """The validation status of one strategy, given its latest completed validation."""
    out = {
        "status": NOT_VALIDATED,
        "eligible": False,
        "reason": NOT_VALIDATED_REASON,
        "validation_id": None,
        "verdict": None,
        "validated_version": None,
        "current_version": strategy.version,
        "completed_at": None,
        "data_end": None,
    }
    if run is None:
        return out
    rs = run.run_settings if isinstance(run.run_settings, dict) else {}
    verdict = report_of(run)["verdict"]
    version = rs.get("strategy_version")
    out.update(
        validation_id=run.id,
        verdict=verdict["status"],
        validated_version=version,
        completed_at=run.completed_at,
        # The last day of data the validation saw (its requested end, else when it ran).
        data_end=_day(rs.get("end_timestamp")) or _day(run.completed_at),
    )
    if version != strategy.version:
        out.update(
            status=OUTDATED,
            reason=(
                f"Validated as version {version}; the strategy is now version {strategy.version} "
                "(its rules or parameters changed). Validate it again."
                if version is not None
                else "The validation did not record which version of the strategy it tested. "
                "Validate it again."
            ),
        )
    elif verdict["status"] == "VALIDATED":
        out.update(status=VALIDATED, reason=verdict["reason"])
    elif verdict["status"] == "PASS":
        out.update(status=PAPER_PENDING, reason=verdict["reason"])
    else:
        out.update(status=FAILED, reason=f"The latest validation did not pass. {verdict['reason']}")
    out["eligible"] = out["status"] in ELIGIBLE
    return out


def validation_statuses(db: Session, strategies: Iterable[Strategy]) -> dict[UUID, dict]:
    """The validation status of each strategy (one query for all of them)."""
    strategies = list(strategies)
    latest = latest_validations(db, [s.id for s in strategies])
    return {s.id: status_from(s, latest.get(s.id)) for s in strategies}


def validation_status(db: Session, strategy: Strategy) -> dict:
    return validation_statuses(db, [strategy])[strategy.id]


def hindsight(status: dict, start: date) -> str | None:
    """Why choosing a strategy by its validation is hindsight in a backtest from
    `start`: the validation used data from inside the backtest period."""
    end = status.get("data_end")
    if not end or date.fromisoformat(end) < start:
        return None
    return (
        f"validated on data up to {end}, after this backtest starts ({start.isoformat()}), "
        "so choosing it by that validation uses hindsight"
    )
