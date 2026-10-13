from datetime import datetime, timedelta, timezone

import pytest

from app.backtesting.analytics import (
    calculate_annualized_return,
    calculate_cumulative_return,
    calculate_periodic_returns,
)


def test_cumulative_return_matches_manual_calculation():
    assert calculate_cumulative_return(100000.0, 110000.0) == pytest.approx(0.10)
    assert calculate_cumulative_return(100000.0, 95000.0) == pytest.approx(-0.05)


def test_periodic_returns_match_manual_calculation():
    equity_curve = [
        {"portfolio_value": 100.0},
        {"portfolio_value": 110.0},
        {"portfolio_value": 99.0},
        {"portfolio_value": 108.9},
    ]

    assert calculate_periodic_returns(equity_curve) == pytest.approx(
        [0.10, -0.10, 0.10]
    )


def test_annualized_return_over_exactly_one_calendar_year():
    start = datetime(2025, 1, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=365.2425)

    result = calculate_annualized_return(100.0, 110.0, start, end)

    assert result == pytest.approx(0.10)


def test_annualized_return_is_none_for_zero_duration():
    timestamp = datetime(2025, 1, 1, tzinfo=timezone.utc)

    assert calculate_annualized_return(
        100.0, 110.0, timestamp, timestamp
    ) is None


@pytest.mark.parametrize(
    ("initial", "final"),
    [(0.0, 100.0), (-1.0, 100.0), (100.0, -1.0)],
)
def test_cumulative_return_rejects_invalid_capital(initial, final):
    with pytest.raises(ValueError):
        calculate_cumulative_return(initial, final)


def test_periodic_returns_reject_zero_equity():
    with pytest.raises(ValueError):
        calculate_periodic_returns(
            [{"portfolio_value": 100.0}, {"portfolio_value": 0.0}]
        )


from app.backtesting.analytics import (
    calculate_downside_deviation,
    calculate_max_drawdown,
    calculate_max_drawdown_duration,
    calculate_volatility,
)


def test_volatility_matches_manual_sample_standard_deviation():
    result = calculate_volatility([0.10, -0.10, 0.10])

    assert result == pytest.approx((1 / 75) ** 0.5)


def test_annualized_volatility_scales_by_square_root_of_frequency():
    periodic = calculate_volatility([0.10, -0.10, 0.10])
    annualized = calculate_volatility(
        [0.10, -0.10, 0.10],
        periods_per_year=252,
    )

    assert annualized == pytest.approx(periodic * (252 ** 0.5))


def test_volatility_returns_none_with_fewer_than_two_observations():
    assert calculate_volatility([]) is None
    assert calculate_volatility([0.05]) is None


def test_max_drawdown_matches_manual_calculation():
    equity_curve = [
        {"portfolio_value": 100.0},
        {"portfolio_value": 120.0},
        {"portfolio_value": 90.0},
        {"portfolio_value": 105.0},
        {"portfolio_value": 120.0},
    ]

    assert calculate_max_drawdown(equity_curve) == pytest.approx(0.25)


def test_max_drawdown_duration_counts_underwater_observations():
    equity_curve = [
        {"portfolio_value": 100.0},
        {"portfolio_value": 120.0},
        {"portfolio_value": 110.0},
        {"portfolio_value": 105.0},
        {"portfolio_value": 120.0},
        {"portfolio_value": 115.0},
        {"portfolio_value": 125.0},
    ]

    assert calculate_max_drawdown_duration(equity_curve) == 2


def test_downside_deviation_matches_manual_calculation():
    result = calculate_downside_deviation([0.10, -0.10, 0.10, -0.20])

    assert result == pytest.approx((0.05 / 4) ** 0.5)


def test_downside_deviation_supports_nonzero_target():
    result = calculate_downside_deviation(
        [0.10, 0.00, 0.20],
        minimum_acceptable_return=0.05,
    )

    assert result == pytest.approx((0.0025 / 3) ** 0.5)


def test_downside_deviation_returns_none_for_empty_returns():
    assert calculate_downside_deviation([]) is None



from app.backtesting.analytics import calculate_trade_statistics


def test_trade_statistics_for_winning_and_losing_trades():
    trades = [
        {"realized_pnl": 200.0},
        {"realized_pnl": -50.0},
        {"realized_pnl": 100.0},
        {"realized_pnl": -25.0},
    ]

    stats = calculate_trade_statistics(trades)

    assert stats["trade_count"] == 4
    assert stats["winning_trades"] == 2
    assert stats["losing_trades"] == 2
    assert stats["win_rate"] == pytest.approx(0.5)
    assert stats["average_gain"] == pytest.approx(150.0)
    assert stats["average_loss"] == pytest.approx(-37.5)
    assert stats["profit_factor"] == pytest.approx(4.0)


def test_trade_statistics_handles_no_trades():
    stats = calculate_trade_statistics([])

    assert stats["trade_count"] == 0
    assert stats["winning_trades"] == 0
    assert stats["losing_trades"] == 0
    assert stats["win_rate"] is None
    assert stats["average_gain"] is None
    assert stats["average_loss"] is None
    assert stats["profit_factor"] is None


def test_trade_statistics_handles_no_losses():
    stats = calculate_trade_statistics([
        {"realized_pnl": 100.0},
        {"realized_pnl": 50.0},
    ])

    assert stats["profit_factor"] is None


def test_trade_statistics_rejects_missing_or_non_finite_pnl():
    with pytest.raises(ValueError):
        calculate_trade_statistics([{"side": "BUY"}])

    with pytest.raises(ValueError):
        calculate_trade_statistics([{"realized_pnl": float("nan")}])


def test_sharpe_ratio_matches_manual_calculation():
    from app.backtesting.analytics import calculate_sharpe_ratio

    returns = [0.02, 0.00, 0.01]
    mean_return = sum(returns) / len(returns)
    sample_volatility = (
        sum((value - mean_return) ** 2 for value in returns) / 2
    ) ** 0.5

    assert calculate_sharpe_ratio(returns) == pytest.approx(
        mean_return / sample_volatility
    )


def test_sharpe_ratio_returns_none_for_insufficient_or_zero_volatility():
    from app.backtesting.analytics import calculate_sharpe_ratio

    assert calculate_sharpe_ratio([0.01]) is None
    assert calculate_sharpe_ratio([0.01, 0.01, 0.01]) is None


def test_sharpe_ratio_supports_annualization():
    from app.backtesting.analytics import calculate_sharpe_ratio

    periodic = calculate_sharpe_ratio([0.01, 0.02, 0.00])
    annualized = calculate_sharpe_ratio(
        [0.01, 0.02, 0.00],
        periods_per_year=252,
    )

    assert annualized == pytest.approx(periodic * (252 ** 0.5))
from datetime import datetime, timezone

import pytest

from app.backtesting.analytics import calculate_completed_position_trades


def test_completed_position_accumulates_partial_closes_and_fees():
    t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 1, 2, tzinfo=timezone.utc)
    t3 = datetime(2026, 1, 3, tzinfo=timezone.utc)

    fills = [
        {
            "timestamp": t1, "instrument_id": "A", "side": "BUY",
            "quantity": 10, "price": 100.0, "realized_pnl": 0.0,
            "closed_quantity": 0, "opened_quantity": 10,
            "total_charges": 10.0,
        },
        {
            "timestamp": t2, "instrument_id": "A", "side": "SELL",
            "quantity": 4, "price": 120.0, "realized_pnl": 80.0,
            "closed_quantity": 4, "opened_quantity": 0,
            "total_charges": 4.0,
        },
        {
            "timestamp": t3, "instrument_id": "A", "side": "SELL",
            "quantity": 6, "price": 90.0, "realized_pnl": -60.0,
            "closed_quantity": 6, "opened_quantity": 0,
            "total_charges": 6.0,
        },
    ]

    completed = calculate_completed_position_trades(fills)

    assert len(completed) == 1
    assert completed[0]["realized_pnl"] == pytest.approx(0.0)
    assert completed[0]["quantity"] == 10
    assert completed[0]["opened_at"] == t1
    assert completed[0]["closed_at"] == t3


def test_reversal_closes_old_lifecycle_and_opens_new_one():
    t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    t2 = datetime(2026, 1, 2, tzinfo=timezone.utc)
    t3 = datetime(2026, 1, 3, tzinfo=timezone.utc)

    fills = [
        {
            "timestamp": t1, "instrument_id": "A", "side": "BUY",
            "quantity": 5, "price": 100.0, "realized_pnl": 0.0,
            "closed_quantity": 0, "opened_quantity": 5,
            "total_charges": 5.0,
        },
        {
            "timestamp": t2, "instrument_id": "A", "side": "SELL",
            "quantity": 8, "price": 110.0, "realized_pnl": 50.0,
            "closed_quantity": 5, "opened_quantity": 3,
            "total_charges": 8.0,
        },
        {
            "timestamp": t3, "instrument_id": "A", "side": "BUY",
            "quantity": 3, "price": 100.0, "realized_pnl": 30.0,
            "closed_quantity": 3, "opened_quantity": 0,
            "total_charges": 3.0,
        },
    ]

    completed = calculate_completed_position_trades(fills)

    assert len(completed) == 2
    assert completed[0]["realized_pnl"] == pytest.approx(40.0)
    assert completed[1]["direction"] == "short"
    assert completed[1]["realized_pnl"] == pytest.approx(24.0)


def test_open_position_is_not_reported_as_completed():
    fill = {
        "timestamp": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "instrument_id": "A", "side": "BUY", "quantity": 2,
        "price": 100.0, "realized_pnl": 0.0,
        "closed_quantity": 0, "opened_quantity": 2,
        "total_charges": 2.0,
    }

    assert calculate_completed_position_trades([fill]) == []
