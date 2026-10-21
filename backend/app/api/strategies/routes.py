from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import StrategyType
from app.models import Strategy, User
from app.schemas.strategies.create import CreateStrategyRequest
from app.schemas.strategies.update import UpdateStrategyRequest
from app.schemas.strategies.response import StrategyResponse
from app.services.strategies.strategy_service import StrategyService
from app.services.validation.eligibility import validation_status, validation_statuses


router = APIRouter(
    prefix="/strategies",
    tags=["Strategies"],
)


def _response(strategy: Strategy, validation: dict) -> StrategyResponse:
    return StrategyResponse(
        id=str(strategy.id),
        user_id=str(strategy.user_id),
        name=strategy.name,
        description=strategy.description,
        strategy_type=strategy.strategy_type.value,
        strategy_config=strategy.strategy_config,
        python_code=strategy.python_code,
        version=strategy.version,
        is_active=strategy.is_active,
        created_at=strategy.created_at.isoformat(),
        updated_at=strategy.updated_at.isoformat(),
        validation=validation,
    )


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Strategy not found.",
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
        python_code=request.python_code,
    )

    return _response(strategy, validation_status(db, strategy))


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

    statuses = validation_statuses(db, strategies)
    return [_response(strategy, statuses[strategy.id]) for strategy in strategies]


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
        raise _not_found()

    return _response(strategy, validation_status(db, strategy))


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
        raise _not_found()

    if (
        request.python_code is not None
        and strategy.strategy_type != StrategyType.PYTHON
    ):
        raise HTTPException(
            status_code=422,
            detail="Only PYTHON strategies can have python_code.",
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
        python_code=request.python_code,
        is_active=request.is_active,
    )

    return _response(strategy, validation_status(db, strategy))


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
        raise _not_found()

    strategy_service.delete_strategy(
        strategy=strategy,
    )
