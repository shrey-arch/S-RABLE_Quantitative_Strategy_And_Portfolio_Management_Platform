import logging
from pathlib import Path
from uuid import uuid4

from app.services.backtesting.job_logging import (
    close_job_logging,
    configure_job_logging,
)


def test_configure_job_logging_creates_execution_and_error_logs(
    tmp_path,
    monkeypatch,
):
    from app.config import settings

    monkeypatch.setattr(settings, "backtest_cache_dir", tmp_path)
    execution_id = uuid4()

    log_dir, job_logger = configure_job_logging(execution_id)

    try:
        job_logger.info("Job started")
        try:
            raise RuntimeError("Example backtest failure")
        except RuntimeError:
            job_logger.exception("Job failed")

        for handler in job_logger.handlers:
            handler.flush()

        execution_log = log_dir / "execution.log"
        error_log = log_dir / "error.log"

        assert execution_log.exists()
        assert error_log.exists()
        assert "Job started" in execution_log.read_text(encoding="utf-8")
        assert "Job failed" in execution_log.read_text(encoding="utf-8")
        assert "Job failed" in error_log.read_text(encoding="utf-8")
        assert "RuntimeError: Example backtest failure" in error_log.read_text(
            encoding="utf-8"
        )
        assert log_dir == (
            Path(tmp_path) / "jobs" / str(execution_id) / "logs"
        )
    finally:
        close_job_logging(job_logger)


def test_close_job_logging_removes_and_closes_file_handlers(
    tmp_path,
    monkeypatch,
):
    from app.config import settings

    monkeypatch.setattr(settings, "backtest_cache_dir", tmp_path)
    _, job_logger = configure_job_logging(uuid4())
    handlers = list(job_logger.handlers)

    assert len(handlers) == 2

    close_job_logging(job_logger)

    assert job_logger.handlers == []
    assert all(handler.stream is None for handler in handlers)
