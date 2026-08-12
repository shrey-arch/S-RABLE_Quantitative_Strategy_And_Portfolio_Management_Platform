from enum import Enum


class Exchange(str, Enum):
    NSE = "NSE"
    BSE = "BSE"
    MCX = "MCX"
    NSE_FO = "NSE_FO"