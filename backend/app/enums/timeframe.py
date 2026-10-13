from enum import Enum


class Timeframe(str, Enum):
    """
    Supported market-data frequencies.
    """

    ONE_MINUTE = "1M"
    FIVE_MINUTES = "5M"
    FIFTEEN_MINUTES = "15M"
    ONE_HOUR = "1H"
    ONE_DAY = "1D"
