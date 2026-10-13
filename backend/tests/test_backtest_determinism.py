import pandas as pd
from uuid import uuid4

from app.backtesting.engine import BacktestEngine
from app.strategies.momentum import MomentumStrategy


def test_identical_momentum_runs_produce_identical_numerical_results():
    data = pd.DataFrame(
        {"close": [
            100.0, 101.0, 102.0, 103.0, 104.0,
            103.0, 101.0, 99.0, 98.0, 100.0,
            102.0, 105.0, 107.0, 106.0, 104.0,
            102.0, 100.0, 103.0, 106.0, 109.0,
            111.0, 108.0, 105.0, 107.0, 112.0,
        ]},
        index=pd.date_range(
            "2026-01-01",
            periods=25,
            freq="D",
            tz="UTC",
        ),
    )

    engine = BacktestEngine()

    result_a = engine.run(
        strategy=MomentumStrategy(lookback=3),
        data=data.copy(),
        initial_capital=10000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=1,
    )
    result_b = engine.run(
        strategy=MomentumStrategy(lookback=3),
        data=data.copy(),
        initial_capital=10000.0,
        execution_id=uuid4(),
        instrument_id=uuid4(),
        quantity=1,
    )

    assert len(result_a.trades) == len(result_b.trades)
    assert result_a.final_capital == result_b.final_capital
    assert result_a.total_return == result_b.total_return
    assert result_a.max_drawdown == result_b.max_drawdown

    assert [
        (trade["side"], trade["quantity"], trade["price"],
         trade["brokerage"], trade["total_charges"])
        for trade in result_a.trades
    ] == [
        (trade["side"], trade["quantity"], trade["price"],
         trade["brokerage"], trade["total_charges"])
        for trade in result_b.trades
    ]

    assert [
        point["portfolio_value"] for point in result_a.equity_curve
    ] == [
        point["portfolio_value"] for point in result_b.equity_curve
    ]
