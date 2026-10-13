from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class BacktestResult:
    start_timestamp: datetime
    end_timestamp: datetime
    initial_capital: float
    final_capital: float
    total_return: float
    trades: list = field(default_factory=list)
    equity_curve: list[dict] = field(default_factory=list)
    max_drawdown: float = 0.0
    performance_stats: dict = field(default_factory=dict)

    def calculate_max_drawdown(self) -> float:
        if not self.equity_curve:
            self.max_drawdown = 0.0
            return self.max_drawdown

        peak = self.equity_curve[0]["portfolio_value"]
        max_drawdown = 0.0

        for point in self.equity_curve:
            value = point["portfolio_value"]

            if value > peak:
                peak = value

            if peak > 0:
                drawdown = (peak - value) / peak
                max_drawdown = max(max_drawdown, drawdown)

        self.max_drawdown = max_drawdown
        return self.max_drawdown
