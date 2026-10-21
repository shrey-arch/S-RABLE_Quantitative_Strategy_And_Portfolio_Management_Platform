from fastapi import APIRouter, Depends, HTTPException, status

from app.core.dependencies import get_current_user
from app.models import User
from app.schemas.strategies.registry import (
    StrategyParameterInfo,
    StrategyParameterValidationRequest,
    StrategyParameterValidationResponse,
    StrategyRegistryEntry,
)
from app.strategies.registry import StrategyRegistry


# Separate prefix so these paths never collide with /strategies/{strategy_id}.
router = APIRouter(
    prefix="/strategy-registry",
    tags=["Strategy Registry"],
)


def _entry(key: str) -> StrategyRegistryEntry:
    definition = StrategyRegistry.definition(key)
    return StrategyRegistryEntry(
        strategy_key=definition.strategy_key,
        parameters=[
            StrategyParameterInfo(
                name=name,
                type=schema.get("type"),
                required=bool(schema.get("required")),
                default=schema.get("default"),
            )
            for name, schema in definition.parameter_schema.items()
        ],
        required_inputs=list(definition.required_indicators),
        instruments=definition.instruments,
    )


@router.get(
    "",
    response_model=list[StrategyRegistryEntry],
)
def list_registry_strategies(
    current_user: User = Depends(get_current_user),
):
    """The built-in strategies the backtest engine can run, in registry order."""
    return [_entry(key) for key in StrategyRegistry.available()]


@router.get(
    "/{strategy_key}",
    response_model=StrategyRegistryEntry,
)
def get_registry_strategy(
    strategy_key: str,
    current_user: User = Depends(get_current_user),
):
    if strategy_key not in StrategyRegistry.available():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Strategy not found.",
        )
    return _entry(strategy_key)


@router.post(
    "/{strategy_key}/validate",
    response_model=StrategyParameterValidationResponse,
)
def validate_registry_parameters(
    strategy_key: str,
    request: StrategyParameterValidationRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Check parameters exactly as a backtest would (StrategyRegistry.get),
    without running anything. Invalid values return 422 with the reason.
    """
    if strategy_key not in StrategyRegistry.available():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Strategy not found.",
        )

    try:
        effective = StrategyRegistry.effective_parameters(
            strategy_key,
            **request.parameters,
        )
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    return StrategyParameterValidationResponse(
        strategy_key=strategy_key,
        effective_parameters=effective,
    )