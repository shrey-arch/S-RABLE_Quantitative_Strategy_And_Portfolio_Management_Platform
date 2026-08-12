from enum import Enum


class InstrumentType(str, Enum):
    EQUITY = "EQUITY"
    FUTURES = "FUTURES"
    OPTIONS = "OPTIONS"
    ETF = "ETF"
    INDEX = "INDEX"