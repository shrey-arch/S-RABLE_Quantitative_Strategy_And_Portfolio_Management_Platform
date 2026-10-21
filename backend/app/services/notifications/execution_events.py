"""Phase 16: one notification for the run's owner when a run finishes.

Called after a run is committed as COMPLETED, FAILED or CANCELLED. A problem
here never changes the run: it is logged and the notification is skipped."""

import logging

from app.enums import (
    ExecutionStatus,
    ExecutionType,
    NotificationPriority,
    NotificationType,
)
from app.models import Execution, Strategy
from app.services.notifications.notification_service import NotificationService


logger = logging.getLogger(__name__)

EVENT = "EXECUTION_FINISHED"

# status -> (type, priority, wording)
FINISHED = {
    ExecutionStatus.COMPLETED: (NotificationType.INFO, NotificationPriority.MEDIUM, "completed"),
    ExecutionStatus.FAILED: (NotificationType.ERROR, NotificationPriority.HIGH, "failed"),
    ExecutionStatus.CANCELLED: (NotificationType.WARNING, NotificationPriority.LOW, "was cancelled"),
}

RUN_LABELS = {
    ExecutionType.BACKTEST: "Backtest",
    ExecutionType.VALIDATION: "Validation",
    ExecutionType.REGIME_TEST: "Regime test",
    ExecutionType.PAPER: "Paper run",
    ExecutionType.LIVE: "Live paper session",
    ExecutionType.PORTFOLIO_BACKTEST: "Portfolio backtest",
}


def notify_execution_finished(db, execution: Execution) -> None:
    event = FINISHED.get(execution.status)
    if event is None or execution.execution_type == ExecutionType.LIVE:
        # Feature 7: a live paper session sends its own notifications (with its P&L).
        return
    try:
        strategy = db.get(Strategy, execution.strategy_id)
        if strategy is None:
            return
        notification_type, priority, wording = event
        label = RUN_LABELS.get(execution.execution_type, "Run")
        message = f'{label} of "{strategy.name}" {wording}.'
        if execution.execution_type == ExecutionType.PORTFOLIO_BACKTEST:
            # A portfolio backtest has several strategies; it is named by the user.
            name = (execution.run_settings or {}).get("name") or "Portfolio"
            message = f'{label} "{name}" {wording}.'
        if execution.status == ExecutionStatus.FAILED and execution.error_message:
            message = f"{message} {execution.error_message}"
        NotificationService(db).create_notification(
            user_id=strategy.user_id,
            execution_id=execution.id,
            notification_type=notification_type,
            priority=priority,
            title=f"{label} {wording}"[:150],
            message=message,
            notification_data={
                "event": EVENT,
                "execution_type": execution.execution_type.value,
                "status": execution.status.value,
                "strategy_name": strategy.name,
            },
        )
    except Exception:
        logger.exception("Could not store the run notification: execution_id=%s", execution.id)
        try:
            db.rollback()
        except Exception:
            logger.exception("Rollback failed after the run notification")
