"""The one backtest executor the API uses. Shared so that submitting (POST
/backtests) and cancelling (POST /executions/{id}/cancel) see the same workers."""

from app.services.backtesting.executor import BacktestExecutor

backtest_executor = BacktestExecutor(max_workers=1)
