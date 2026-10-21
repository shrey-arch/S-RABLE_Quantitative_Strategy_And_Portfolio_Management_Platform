from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        return self.db.scalar(statement)

    def create_user(
        self,
        *,
        full_name: str,
        email: str,
        password_hash: str,
    ) -> User:
        user = User(
            full_name=full_name,
            email=email,
            password_hash=password_hash,
        )

        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        return user

    def update_user(
        self,
        user: User,
        *,
        full_name: str | None = None,
        phone_number: str | None = None,
        profile_image_url: str | None = None,
    ) -> User:
        if full_name is not None:
            user.full_name = full_name

        # An empty value clears the field.
        if phone_number is not None:
            user.phone_number = phone_number or None

        if profile_image_url is not None:
            user.profile_image_url = profile_image_url or None

        self.db.commit()
        self.db.refresh(user)

        return user

    def record_login(self, user: User) -> User:
        user.last_login_at = datetime.now(timezone.utc)
        self.db.commit()
        return user

    def update_password(
        self,
        user: User,
        *,
        password_hash: str,
    ) -> User:
        user.password_hash = password_hash

        self.db.commit()
        self.db.refresh(user)

        return user