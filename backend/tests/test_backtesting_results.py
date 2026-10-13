from datetime import datetime, timezone

import pytest

from app.backtesting.results import BacktestResult


def test_max_drawdown_is_calculated_from_equity_curve():
    result = BacktestResult(
        start_timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_timestamp=datetime(2026, 1, 4, tzinfo=timezone.utc),
        initial_capital=100000.0,
        final_capital=95000.0,
        total_return=-0.05,
        equity_curve=[
            {
                "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc),
                "portfolio_value": 100000.0,
            },
            {
                "timestamp": datetime(2026, 1, 2, tzinfo=timezone.utc),
                "portfolio_value": 110000.0,
            },
            {
                "timestamp": datetime(2026, 1, 3, tzinfo=timezone.utc),
                "portfolio_value": 99000.0,
            },
            {
                "timestamp": datetime(2026, 1, 4, tzinfo=timezone.utc),
                "portfolio_value": 95000.0,
            },
        ],
    )

    drawdown = result.calculate_max_drawdown()

    assert drawdown == pytest.approx(0.1363636364)
    assert result.max_drawdown == pytest.approx(0.1363636364)


def test_empty_equity_curve_has_zero_drawdown():
    result = BacktestResult(
        start_timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc),
        initial_capital=100000.0,
        final_capital=100000.0,
        total_return=0.0,
    )

    assert result.calculate_max_drawdown() == 0.0
