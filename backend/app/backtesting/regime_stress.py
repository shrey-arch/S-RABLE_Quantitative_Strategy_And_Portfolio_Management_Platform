from __future__ import annotations

from uuid import UUID

import pandas as pd

from app.backtesting.engine import BacktestEngine


class RegimeStressAnalyzer:
    """Backtest contiguous, explicitly labeled market-regime segments independently.

Each segment uses a fresh strategy and portfolio. Positions and indicator state
do not carry across regime boundaries; results describe independent segments,
not one continuous portfolio across all regimes.
"""

    def __init__(
        self,
        engine: BacktestEngine | None = None,
        *,
        min_segment_length: int = 1,
    ):
        if (
            isinstance(min_segment_length, bool)
            or not isinstance(min_segment_length, int)
            or min_segment_length <= 0
        ):
            raise ValueError("min_segment_length must be a positive integer.")

        self.engine = engine or BacktestEngine()
        self.min_segment_length = min_segment_length

    def run(
        self,
        *,
        strategy_factory,
        data: pd.DataFrame,
        regimes: pd.Series,
        execution_id: UUID,
        instrument_id: UUID,
        initial_capital: float,
        quantity: int = 1,
    ) -> dict:
        if not isinstance(data, pd.DataFrame):
            raise ValueError("data must be a pandas DataFrame.")
        if data.empty:
            raise ValueError("data cannot be empty.")
        if not data.index.is_unique or not data.index.is_monotonic_increasing:
            raise ValueError("data index must be unique and chronological.")
        if not isinstance(regimes, pd.Series):
            raise ValueError("regimes must be a pandas Series.")
        if not regimes.index.is_unique:
            raise ValueError("regimes index must be unique.")
        if not regimes.index.equals(data.index):
            raise ValueError("regimes index must exactly match data index.")
        if regimes.isna().any():
            raise ValueError("regimes cannot contain missing labels.")
        if initial_capital <= 0:
            raise ValueError("initial_capital must be greater than 0.")
        if quantity <= 0:
            raise ValueError("quantity must be greater than 0.")
        if not callable(strategy_factory):
            raise ValueError("strategy_factory must be callable.")

        segments = []
        start = 0
        labels = regimes.tolist()

        for position in range(1, len(labels) + 1):
            if position == len(labels) or labels[position] != labels[start]:
                segments.append((labels[start], start, position))
                start = position

        for label, start, end in segments:
            segment_length = end - start
            if segment_length < self.min_segment_length:
                raise ValueError(
                    f"Regime segment {label!r} has {segment_length} samples; "
                    f"minimum is {self.min_segment_length}."
                )
        results = {}
        label_counts = {}

        for label, start, end in segments:
            label_key = str(label)
            label_counts[label_key] = label_counts.get(label_key, 0) + 1
            occurrence = label_counts[label_key]
            key = label_key if occurrence == 1 else f"{label_key}#{occurrence}"

            segment = data.iloc[start:end].copy()
            result = self.engine.run(
                strategy=strategy_factory(),
                data=segment,
                execution_id=execution_id,
                instrument_id=instrument_id,
                initial_capital=initial_capital,
                quantity=quantity,
            )

            stats = result.performance_stats
            results[key] = {
                "regime": label_key,
                "occurrence": occurrence,
                "start_timestamp": result.start_timestamp,
                "end_timestamp": result.end_timestamp,
                "sample_count": len(segment),
                "initial_capital": result.initial_capital,
                "final_capital": result.final_capital,
                "total_return": result.total_return,
                "max_drawdown": result.max_drawdown,
                "trade_count": len(result.trades),
                "volatility": stats.get("volatility"),
                "sharpe_ratio": stats.get("sharpe_ratio"),
                "equity_curve": result.equity_curve,
                "trades": result.trades,
            }

        returns = [item["total_return"] for item in results.values()]
        drawdowns = [item["max_drawdown"] for item in results.values()]

        return {
            "regime_count": len(results),
            "total_samples": len(data),
            "worst_return": min(returns),
            "worst_drawdown": max(drawdowns),
            "regimes": results,
        }



class RegimeStressTester(RegimeStressAnalyzer):
    """Public Phase 8 name for regime stress testing."""
