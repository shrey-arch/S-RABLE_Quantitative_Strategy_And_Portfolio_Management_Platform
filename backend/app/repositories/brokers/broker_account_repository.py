from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.enums import ConnectionStatus

from app.models import BrokerAccount


class BrokerAccountRepository:
    def __init__(self, db: Session):
        self.db = db

    def create_for_user(
        self,
        *,
        user_id: UUID,
        broker_name,
        broker_user_id: str,
        account_alias: str | None,
        api_key: str,
        api_secret: str,
    ) -> BrokerAccount:
        broker_account = BrokerAccount(
            user_id=user_id,
            broker_name=broker_name,
            broker_user_id=broker_user_id,
            account_alias=account_alias,
            api_key=api_key,
            api_secret=api_secret,
        )

        self.db.add(broker_account)
        self.db.commit()
        self.db.refresh(broker_account)

        return broker_account

    def list_for_user(
        self,
        *,
        user_id: UUID,
    ) -> list[BrokerAccount]:
        statement = (
            select(BrokerAccount)
            .where(BrokerAccount.user_id == user_id)
            .order_by(BrokerAccount.created_at.desc())
        )

        return list(self.db.scalars(statement).all())

    def get_by_id_for_user(
        self,
        *,
        broker_account_id: UUID,
        user_id: UUID,
    ) -> BrokerAccount | None:
        statement = (
            select(BrokerAccount)
            .where(
                BrokerAccount.id == broker_account_id,
                BrokerAccount.user_id == user_id,
            )
        )

        return self.db.scalar(statement)

    def update_for_user(
        self,
        *,
        broker_account: BrokerAccount,
        account_alias: str | None = None,
        is_active: bool | None = None,
    ) -> BrokerAccount:
        if account_alias is not None:
            broker_account.account_alias = account_alias

        if is_active is not None:
            broker_account.is_active = is_active

        self.db.commit()
        self.db.refresh(broker_account)

        return broker_account

    def connect_account(
        self,
        *,
        broker_account: BrokerAccount,
        access_token: str,
        refresh_token: str | None = None,
    ) -> BrokerAccount:
        broker_account.access_token = access_token
        broker_account.refresh_token = refresh_token
        broker_account.connection_status = ConnectionStatus.CONNECTED

        self.db.commit()
        self.db.refresh(broker_account)

        return broker_account

    def disconnect_account(
        self,
        *,
        broker_account: BrokerAccount,
    ) -> BrokerAccount:
        broker_account.access_token = None
        broker_account.refresh_token = None
        broker_account.connection_status = ConnectionStatus.DISCONNECTED

        self.db.commit()
        self.db.refresh(broker_account)

        return broker_account

    def delete_for_user(
       self,
       *,
       broker_account: BrokerAccount,
    ) -> None:
       self.db.delete(broker_account)
       self.db.commit()

    def get_by_broker_identity(
       self,
       *,
       user_id: UUID,
       broker_name,
       broker_user_id: str,
    ) -> BrokerAccount | None:
       statement = (
        select(BrokerAccount)
        .where(
            BrokerAccount.user_id == user_id,
            BrokerAccount.broker_name == broker_name,
            BrokerAccount.broker_user_id == broker_user_id,
        )
    )

       return self.db.scalar(statement)
