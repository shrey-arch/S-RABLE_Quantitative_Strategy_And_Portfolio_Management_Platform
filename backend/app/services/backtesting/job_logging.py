from __future__ import annotations

import logging
from pathlib import Path
from uuid import UUID

from app.config import settings


def configure_job_logging(execution_id: UUID | str) -> tuple[Path, logging.Logger]:
    """Configure isolated file logging for one backtest execution."""
    log_dir = (
        Path(settings.backtest_cache_dir)
        / "jobs"
        / str(execution_id)
        / "logs"
    )
    log_dir.mkdir(parents=True, exist_ok=True)

    job_logger = logging.getLogger(f"backtest.job.{execution_id}")
    job_logger.setLevel(logging.INFO)
    job_logger.propagate = True

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s"
    )

    execution_handler = logging.FileHandler(
        log_dir / "execution.log",
        encoding="utf-8",
    )
    execution_handler.setLevel(logging.INFO)
    execution_handler.setFormatter(formatter)

    error_handler = logging.FileHandler(
        log_dir / "error.log",
        encoding="utf-8",
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(formatter)

    job_logger.addHandler(execution_handler)
    job_logger.addHandler(error_handler)

    return log_dir, job_logger


def close_job_logging(job_logger: logging.Logger) -> None:
    """Flush and remove handlers created for a job."""
    for handler in list(job_logger.handlers):
        job_logger.removeHandler(handler)
        try:
            handler.flush()
        finally:
            handler.close()
from pathlib import Path
from uuid import UUID

from app.config import settings


def append_job_error(
    execution_id: UUID | str,
    message: str,
    *,
    traceback_text: str | None = None,
) -> None:
    """Append a parent-process failure to the execution's error log."""
    log_dir = (
        Path(settings.backtest_cache_dir)
        / "jobs"
        / str(execution_id)
        / "logs"
    )
    log_dir.mkdir(parents=True, exist_ok=True)

    log_path = log_dir / "error.log"
    with log_path.open("a", encoding="utf-8") as log_file:
        log_file.write(f"{message.rstrip()}\n")
        if traceback_text:
            log_file.write(traceback_text.rstrip() + "\n")
