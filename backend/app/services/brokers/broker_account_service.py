from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.models import BrokerAccount
from app.repositories.brokers.broker_account_repository import (
    BrokerAccountRepository,
)


class BrokerAccountService:
    def __init__(self, db):
        self.repository = BrokerAccountRepository(db)

    def create_broker_account(
        self,
        *,
        user_id: UUID,
        broker_name,
        broker_user_id: str,
        account_alias: str | None,
        api_key: str,
        api_secret: str,
    ) -> BrokerAccount:
        existing_account = self.repository.get_by_broker_identity(
            user_id=user_id,
            broker_name=broker_name,
            broker_user_id=broker_user_id,
        )

        if existing_account:
            raise ValueError(
                "This broker account is already connected to your account."
            )

        try:
            return self.repository.create_for_user(
                user_id=user_id,
                broker_name=broker_name,
                broker_user_id=broker_user_id,
                account_alias=account_alias,
                api_key=api_key,
                api_secret=api_secret,
            )
        except IntegrityError as exc:
            raise ValueError(
                "This broker account is already connected to your account."
            ) from exc

    def list_broker_accounts(
        self,
        *,
        user_id: UUID,
    ) -> list[BrokerAccount]:
        return self.repository.list_for_user(
            user_id=user_id,
        )

    def get_broker_account(
        self,
        *,
        broker_account_id: UUID,
        user_id: UUID,
    ) -> BrokerAccount | None:
        return self.repository.get_by_id_for_user(
            broker_account_id=broker_account_id,
            user_id=user_id,
        )

    def update_broker_account(
        self,
        *,
        broker_account: BrokerAccount,
        account_alias: str | None = None,
        is_active: bool | None = None,
    ) -> BrokerAccount:
        return self.repository.update_for_user(
            broker_account=broker_account,
            account_alias=account_alias,
            is_active=is_active,
        )

    def connect_broker_account(
        self,
        *,
        broker_account: BrokerAccount,
        access_token: str,
        refresh_token: str | None = None,
    ) -> BrokerAccount:
        return self.repository.connect_account(
            broker_account=broker_account,
            access_token=access_token,
            refresh_token=refresh_token,
        )

    def disconnect_broker_account(
        self,
        *,
        broker_account: BrokerAccount,
    ) -> BrokerAccount:
        return self.repository.disconnect_account(
            broker_account=broker_account,
        )

    def delete_broker_account(
        self,
        *,
        broker_account: BrokerAccount,
    ) -> None:
        self.repository.delete_for_user(
            broker_account=broker_account,
        )