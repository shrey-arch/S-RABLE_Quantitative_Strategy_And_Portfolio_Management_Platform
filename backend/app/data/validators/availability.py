from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class UnavailablePeriodIssue:
    start: datetime
    end: datetime
    reason: str
