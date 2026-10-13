from abc import ABC, abstractmethod

import pandas as pd


class Indicator(ABC):
    """Base contract for all quantitative indicators."""

    @abstractmethod
    def calculate(self, data: pd.DataFrame) -> pd.Series | pd.DataFrame:
        """Calculate the indicator from a time-indexed DataFrame."""
        raise NotImplementedError
