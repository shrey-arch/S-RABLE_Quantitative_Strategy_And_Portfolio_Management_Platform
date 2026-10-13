from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class SimulatedFill:
    """
    Result of a simulated order execution.
    """

    quantity: int
    price: float
    brokerage: float
    total_charges: float
    timestamp: datetime

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("quantity must be greater than 0.")

        if self.price <= 0:
            raise ValueError("price must be greater than 0.")

        if self.brokerage < 0:
            raise ValueError("brokerage cannot be negative.")

        if self.total_charges < 0:
            raise ValueError("total_charges cannot be negative.")
