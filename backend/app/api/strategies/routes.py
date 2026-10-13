from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.models import User
from app.schemas.strategies.create import CreateStrategyRequest
from app.schemas.strategies.update import UpdateStrategyRequest
from app.schemas.strategies.response import StrategyResponse
from app.services.strategies.strategy_service import StrategyService


router = APIRouter(
    prefix="/strategies",
    tags=["Strategies"],
)


@router.post(
    "",
    response_model=StrategyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_strategy(
    request: CreateStrategyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    strategy_service = StrategyService(db)

    strategy = strategy_service.create_strategy(
        user_id=current_user.id,
        name=request.name,
        description=request.description,
        strategy_type=request.strategy_type,
        strategy_config=request.strategy_config.model_dump(),
    )

    return StrategyResponse(
        id=str(strategy.id),
        user_id=str(strategy.user_id),
        name=strategy.name,
        description=strategy.description,
        strategy_type=strategy.strategy_type.value,
        strategy_config=strategy.strategy_config,
        version=strategy.version,
        is_active=strategy.is_active,
        created_at=strategy.created_at.isoformat(),
        updated_at=strategy.updated_at.isoformat(),
    )

@router.get(
    "",
    response_model=list[StrategyResponse],
)
def list_strategies(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    strategy_service = StrategyService(db)

    strategies = strategy_service.list_strategies(
        user_id=current_user.id,
    )

    return [
        StrategyResponse(
            id=str(strategy.id),
            user_id=str(strategy.user_id),
            name=strategy.name,
            description=strategy.description,
            strategy_type=strategy.strategy_type.value,
            strategy_config=strategy.strategy_config,
            version=strategy.version,
            is_active=strategy.is_active,
            created_at=strategy.created_at.isoformat(),
            updated_at=strategy.updated_at.isoformat(),
        )
        for strategy in strategies
    ]

@router.get(
    "/{strategy_id}",
    response_model=StrategyResponse,
)
def get_strategy(
    strategy_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    strategy_service = StrategyService(db)

    strategy = strategy_service.get_strategy(
        strategy_id=strategy_id,
        user_id=current_user.id,
    )

    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Strategy not found.",
        )

    return StrategyResponse(
        id=str(strategy.id),
        user_id=str(strategy.user_id),
        name=strategy.name,
        description=strategy.description,
        strategy_type=strategy.strategy_type.value,
        strategy_config=strategy.strategy_config,
        version=strategy.version,
        is_active=strategy.is_active,
        created_at=strategy.created_at.isoformat(),
        updated_at=strategy.updated_at.isoformat(),
    )

@router.patch(
    "/{strategy_id}",
    response_model=StrategyResponse,
)
def update_strategy(
    strategy_id: UUID,
    request: UpdateStrategyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    strategy_service = StrategyService(db)

    strategy = strategy_service.get_strategy(
        strategy_id=strategy_id,
        user_id=current_user.id,
    )

    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Strategy not found.",
        )

    strategy = strategy_service.update_strategy(
        strategy=strategy,
        name=request.name,
        description=request.description,
        strategy_config=(
         request.strategy_config.model_dump()
         if request.strategy_config is not None
         else None
        ),
        is_active=request.is_active,
    )

    return StrategyResponse(
        id=str(strategy.id),
        user_id=str(strategy.user_id),
        name=strategy.name,
        description=strategy.description,
        strategy_type=strategy.strategy_type.value,
        strategy_config=strategy.strategy_config,
        version=strategy.version,
        is_active=strategy.is_active,
        created_at=strategy.created_at.isoformat(),
        updated_at=strategy.updated_at.isoformat(),
    )

@router.delete(
    "/{strategy_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_strategy(
    strategy_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    strategy_service = StrategyService(db)

    strategy = strategy_service.get_strategy(
        strategy_id=strategy_id,
        user_id=current_user.id,
    )

    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Strategy not found.",
        )

    strategy_service.delete_strategy(
        strategy=strategy,
    )