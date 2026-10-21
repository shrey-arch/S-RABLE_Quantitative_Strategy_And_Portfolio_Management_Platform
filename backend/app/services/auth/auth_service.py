from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    hash_password,
    verify_password,
)
from app.models import User
from app.repositories.auth.user_repository import UserRepository


class AuthService:
    def __init__(self, db: Session):
        self.user_repository = UserRepository(db)

    def register_user(
        self,
        *,
        full_name: str,
        email: str,
        password: str,
    ) -> User:
        existing_user = self.user_repository.get_by_email(email)

        if existing_user:
            raise ValueError("A user with this email already exists.")

        password_hash = hash_password(password)

        return self.user_repository.create_user(
            full_name=full_name,
            email=email,
            password_hash=password_hash,
        )

    def login_user(
        self,
        *,
        email: str,
        password: str,
    ) -> str:
        user = self.user_repository.get_by_email(email)

        if not user:
            raise ValueError("Invalid email or password.")

        if not verify_password(password, user.password_hash):
            raise ValueError("Invalid email or password.")

        if user.account_status.value != "ACTIVE":
            raise ValueError("User account is not active.")

        # Phase 16: the profile shows when the user last logged in.
        self.user_repository.record_login(user)

        return create_access_token(str(user.id))

    def update_profile(
        self,
        user: User,
        *,
        full_name: str | None = None,
        phone_number: str | None = None,
        profile_image_url: str | None = None,
    ) -> User:
        return self.user_repository.update_user(
            user,
            full_name=full_name,
            phone_number=phone_number,
            profile_image_url=profile_image_url,
        )

    def change_password(
        self,
        user: User,
        *,
        current_password: str,
        new_password: str,
    ) -> None:
        if not verify_password(current_password, user.password_hash):
            raise ValueError("Current password is incorrect.")

        if current_password == new_password:
            raise ValueError(
                "New password must be different from the current password."
            )

        new_password_hash = hash_password(new_password)

        self.user_repository.update_password(
            user,
            password_hash=new_password_hash,
        )