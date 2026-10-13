from pydantic import BaseModel, Field


class UpdateProfileRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    phone_number: str | None = Field(default=None, max_length=20)
    profile_image_url: str | None = None


class UserProfileResponse(BaseModel):
    id: str
    full_name: str
    email: str
    account_status: str
    email_verified: bool
    phone_number: str | None
    profile_image_url: str | None
    last_login_at: str | None
    created_at: str