from abc import ABC, abstractmethod

from app.strategies.context import StrategyContext
from app.strategies.signal import StrategySignal


class Strategy(ABC):
    @abstractmethod
    def generate_signal(self, context: StrategyContext) -> StrategySignal:
        ...
