from enum import Enum


class BrokerName(str, Enum):
    ZERODHA = "ZERODHA"
    UPSTOX = "UPSTOX"
    ANGEL_ONE = "ANGEL_ONE"
    DHAN = "DHAN"