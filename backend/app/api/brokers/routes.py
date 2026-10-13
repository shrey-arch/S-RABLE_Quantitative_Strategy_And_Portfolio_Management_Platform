from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.schemas.brokers.connect import ConnectBrokerAccountRequest
from app.core.dependencies import get_current_user
from app.db import get_db
from app.models import User
from uuid import UUID
from app.schemas.brokers.create import (
    BrokerAccountResponse,
    CreateBrokerAccountRequest,
)
from app.schemas.brokers.update import UpdateBrokerAccountRequest
from app.services.brokers.broker_account_service import BrokerAccountService


router = APIRouter(
    prefix="/brokers",
    tags=["Brokers"],
)


@router.post(
    "/accounts",
    response_model=BrokerAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_broker_account(
    request: CreateBrokerAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    try:
        broker_account = broker_service.create_broker_account(
            user_id=current_user.id,
            broker_name=request.broker_name,
            broker_user_id=request.broker_user_id,
            account_alias=request.account_alias,
            api_key=request.api_key,
            api_secret=request.api_secret,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return BrokerAccountResponse(
        id=str(broker_account.id),
        broker_name=broker_account.broker_name.value,
        broker_user_id=broker_account.broker_user_id,
        account_alias=broker_account.account_alias,
        connection_status=broker_account.connection_status.value,
        is_active=broker_account.is_active,
        last_synced_at=(
            broker_account.last_synced_at.isoformat()
            if broker_account.last_synced_at
            else None
        ),
        created_at=broker_account.created_at.isoformat(),
    )

@router.get(
    "/accounts",
    response_model=list[BrokerAccountResponse],
)
def list_broker_accounts(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    broker_accounts = broker_service.list_broker_accounts(
        user_id=current_user.id,
    )

    return [
        BrokerAccountResponse(
            id=str(broker_account.id),
            broker_name=broker_account.broker_name.value,
            broker_user_id=broker_account.broker_user_id,
            account_alias=broker_account.account_alias,
            connection_status=broker_account.connection_status.value,
            is_active=broker_account.is_active,
            last_synced_at=(
                broker_account.last_synced_at.isoformat()
                if broker_account.last_synced_at
                else None
            ),
            created_at=broker_account.created_at.isoformat(),
        )
        for broker_account in broker_accounts
    ]

@router.get(
    "/accounts/{broker_account_id}",
    response_model=BrokerAccountResponse,
)
def get_broker_account(
    broker_account_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    broker_account = broker_service.get_broker_account(
        broker_account_id=broker_account_id,
        user_id=current_user.id,
    )

    if not broker_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Broker account not found.",
        )

    return BrokerAccountResponse(
        id=str(broker_account.id),
        broker_name=broker_account.broker_name.value,
        broker_user_id=broker_account.broker_user_id,
        account_alias=broker_account.account_alias,
        connection_status=broker_account.connection_status.value,
        is_active=broker_account.is_active,
        last_synced_at=(
            broker_account.last_synced_at.isoformat()
            if broker_account.last_synced_at
            else None
        ),
        created_at=broker_account.created_at.isoformat(),
    )

@router.post(
    "/accounts/{broker_account_id}/connect",
    response_model=BrokerAccountResponse,
)
def connect_broker_account(
    broker_account_id: UUID,
    request: ConnectBrokerAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    broker_account = broker_service.get_broker_account(
        broker_account_id=broker_account_id,
        user_id=current_user.id,
    )

    if not broker_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Broker account not found.",
        )

    broker_account = broker_service.connect_broker_account(
        broker_account=broker_account,
        access_token=request.access_token,
        refresh_token=request.refresh_token,
    )

    return BrokerAccountResponse(
        id=str(broker_account.id),
        broker_name=broker_account.broker_name.value,
        broker_user_id=broker_account.broker_user_id,
        account_alias=broker_account.account_alias,
        connection_status=broker_account.connection_status.value,
        is_active=broker_account.is_active,
        last_synced_at=(
            broker_account.last_synced_at.isoformat()
            if broker_account.last_synced_at
            else None
        ),
        created_at=broker_account.created_at.isoformat(),
    )

@router.post(
    "/accounts/{broker_account_id}/disconnect",
    response_model=BrokerAccountResponse,
)
def disconnect_broker_account(
    broker_account_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    broker_account = broker_service.get_broker_account(
        broker_account_id=broker_account_id,
        user_id=current_user.id,
    )

    if not broker_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Broker account not found.",
        )

    broker_account = broker_service.disconnect_broker_account(
        broker_account=broker_account,
    )

    return BrokerAccountResponse(
        id=str(broker_account.id),
        broker_name=broker_account.broker_name.value,
        broker_user_id=broker_account.broker_user_id,
        account_alias=broker_account.account_alias,
        connection_status=broker_account.connection_status.value,
        is_active=broker_account.is_active,
        last_synced_at=(
            broker_account.last_synced_at.isoformat()
            if broker_account.last_synced_at
            else None
        ),
        created_at=broker_account.created_at.isoformat(),
    )

@router.patch(
    "/accounts/{broker_account_id}",
    response_model=BrokerAccountResponse,
)
def update_broker_account(
    broker_account_id: UUID,
    request: UpdateBrokerAccountRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    broker_account = broker_service.get_broker_account(
        broker_account_id=broker_account_id,
        user_id=current_user.id,
    )

    if not broker_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Broker account not found.",
        )

    broker_account = broker_service.update_broker_account(
        broker_account=broker_account,
        account_alias=request.account_alias,
        is_active=request.is_active,
    )

    return BrokerAccountResponse(
        id=str(broker_account.id),
        broker_name=broker_account.broker_name.value,
        broker_user_id=broker_account.broker_user_id,
        account_alias=broker_account.account_alias,
        connection_status=broker_account.connection_status.value,
        is_active=broker_account.is_active,
        last_synced_at=(
            broker_account.last_synced_at.isoformat()
            if broker_account.last_synced_at
            else None
        ),
        created_at=broker_account.created_at.isoformat(),
    )

@router.delete(
    "/accounts/{broker_account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_broker_account(
    broker_account_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    broker_service = BrokerAccountService(db)

    broker_account = broker_service.get_broker_account(
        broker_account_id=broker_account_id,
        user_id=current_user.id,
    )

    if not broker_account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Broker account not found.",
        )

    broker_service.delete_broker_account(
        broker_account=broker_account,
    )