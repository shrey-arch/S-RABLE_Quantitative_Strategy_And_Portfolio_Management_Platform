from pydantic import BaseModel, ConfigDict


class UpdateNotificationRequest(BaseModel):
    """Phase 16: the only change a user makes is read / unread.

    The server sets read_at: now when marked read, cleared when marked unread."""

    model_config = ConfigDict(extra="forbid")

    is_read: bool
