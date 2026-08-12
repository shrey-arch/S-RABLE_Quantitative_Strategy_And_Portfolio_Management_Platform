from enum import Enum


class NotificationType(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    TRADE = "TRADE"