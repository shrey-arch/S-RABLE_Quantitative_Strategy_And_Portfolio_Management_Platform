"""On startup, backtests and validation runs that were PENDING or RUNNING belonged to the previous
server process: its workers are gone, so those runs can never finish. They are
marked FAILED with a clear code instead of staying "running" forever."""

import logging

from sqlalchemy import select

from app.db import SessionLocal
from app.enums import ExecutionStatus, ExecutionType
from app.models import Execution
from app.services.executions.execution_service import ExecutionService

logger = logging.getLogger(__name__)

WORKER_LOST_MESSAGE = "The server restarted while this backtest was waiting or running."


def fail_stranded_backtests() -> int:
    db = SessionLocal()
    try:
        stranded = list(
            db.scalars(
                select(Execution).where(
                    Execution.execution_type.in_(
                        [ExecutionType.BACKTEST, ExecutionType.VALIDATION]
                    ),
                    Execution.status.in_([ExecutionStatus.PENDING, ExecutionStatus.RUNNING]),
                )
            ).all()
        )
        service = ExecutionService(db)
        for execution in stranded:
            try:
                service.fail_execution(
                    execution=execution,
                    error_message=WORKER_LOST_MESSAGE,
                    error_details={
                        "category": "WORKER",
                        "code": "BACKTEST_WORKER_LOST",
                        "message": WORKER_LOST_MESSAGE,
                        "stage": "startup",
                        "execution_id": str(execution.id),
                    },
                )
            except ValueError:
                db.rollback()  # finished meanwhile; leave it
        if stranded:
            logger.warning("Marked %s stranded backtest(s) as FAILED.", len(stranded))
        return len(stranded)
    finally:
        db.close()
