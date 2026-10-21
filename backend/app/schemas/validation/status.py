"""Feature 5: a strategy's validation status (app/services/validation/eligibility.py)."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

ValidationStatusValue = Literal[
    "VALIDATED", "VALIDATED_PAPER_PENDING", "FAILED", "OUTDATED", "NOT_VALIDATED"
]


class ValidationStatus(BaseModel):
    status: ValidationStatusValue
    eligible: bool = Field(description="VALIDATED or VALIDATED_PAPER_PENDING: may receive capital.")
    reason: str
    validation_id: UUID | None = Field(description="The latest completed validation.")
    verdict: str | None = Field(description="That validation's verdict.")
    validated_version: int | None = Field(description="The strategy version it validated.")
    current_version: int
    completed_at: datetime | None
    data_end: str | None = Field(description="The last day (IST) of data the validation used.")
