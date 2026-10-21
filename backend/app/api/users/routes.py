from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.models import User
from app.schemas.users.update import (
    UpdateProfileRequest,
    UserProfileResponse,
)
from app.services.auth.auth_service import AuthService



router = APIRouter(
    prefix="/users",
    tags=["Users"],
)


def _profile(user: User) -> UserProfileResponse:
    return UserProfileResponse(
        id=str(user.id),
        full_name=user.full_name,
        email=user.email,
        account_status=user.account_status.value,
        email_verified=user.email_verified,
        phone_number=user.phone_number,
        profile_image_url=user.profile_image_url,
        last_login_at=(
            user.last_login_at.isoformat()
            if user.last_login_at
            else None
        ),
        created_at=user.created_at.isoformat(),
    )


@router.get(
    "/me",
    response_model=UserProfileResponse,
)
def get_current_user_profile(
    current_user: User = Depends(get_current_user),
):
    return _profile(current_user)


@router.patch(
    "/me",
    response_model=UserProfileResponse,
)
def update_current_user_profile(
    request: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Only full name, phone number and profile image URL can be changed."""
    auth_service = AuthService(db)

    user = auth_service.update_profile(
        current_user,
        full_name=request.full_name,
        phone_number=request.phone_number,
        profile_image_url=request.profile_image_url,
    )

    return _profile(user)
