from pydantic import BaseModel, ConfigDict, Field, field_validator


class UpdateProfileRequest(BaseModel):
    """The profile fields a user may change. Email, account status and email
    verification are not editable. An empty phone number or image URL clears it."""

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    phone_number: str | None = Field(default=None, max_length=20)
    profile_image_url: str | None = Field(default=None, max_length=500)

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Full name must have at least 2 characters.")
        return value

    @field_validator("phone_number")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value and not all(c.isdigit() or c in "+-() " for c in value):
            raise ValueError("Phone number may use digits, spaces and + - ( ) only.")
        return value

    @field_validator("profile_image_url")
    @classmethod
    def _image(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if value and not value.lower().startswith(("https://", "http://")):
            raise ValueError("Profile image URL must start with http:// or https://.")
        return value


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
