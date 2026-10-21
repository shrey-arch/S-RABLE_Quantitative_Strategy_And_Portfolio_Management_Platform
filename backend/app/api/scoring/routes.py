"""Multi-factor scoring (Phase 13): why the user's strategies rank as they do.

Scores are computed on request and never stored. Custom weights apply to one
request only. Every number on the Scoring page comes from here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db import get_db
from app.ml import factor_definitions as defs
from app.ml.scoring import DEFAULT_STRATEGY_WEIGHTS, FACTOR_DIRECTIONS, STRATEGY_FACTORS
from app.models import User
from app.schemas.scoring import RegimeFit, ScoreRequest, ScoringDefinitions, ScoringResult
from app.services.scoring import service

router = APIRouter(prefix="/scoring", tags=["Scoring"])


@router.get("/definitions", response_model=ScoringDefinitions)
def scoring_definitions(current_user: User = Depends(get_current_user)):
    """How scores are made: factors, directions, default weights and regime rules."""
    return {
        "method": defs.METHOD,
        "windows": defs.WINDOWS,
        "bounds": defs.BOUNDS,
        "directions": defs.DIRECTIONS,
        "factors": [{"name": name, **info} for name, info in defs.FACTORS.items()],
        "strategies": [
            {
                "strategy_key": key,
                "factors": [
                    {"name": name, "direction": FACTOR_DIRECTIONS[key][name]}
                    for name in STRATEGY_FACTORS[key]
                ],
                "default_weights": DEFAULT_STRATEGY_WEIGHTS[key],
                "regime_rule": {
                    "trend_states": defs.REGIME_RULES[key]["trend_states"],
                    "volatility_states": defs.REGIME_RULES[key]["volatility_states"],
                    "rule": defs.REGIME_RULES[key]["rule"],
                },
            }
            for key in STRATEGY_FACTORS
        ],
    }


@router.post(
    "",
    response_model=ScoringResult,
    responses={422: {"description": "The custom weights are not valid."}},
)
def score(
    request: ScoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Score and rank the current user's strategies (nothing is saved)."""
    try:
        return service.score_strategies(db, current_user.id, request.weights)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/regime-fit", response_model=RegimeFit)
def regime_fit(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Each core strategy's compatibility with the current regime, by the rule table."""
    regime = service.current_regime(db)
    return {
        "regime": regime,
        "strategies": [
            {
                "strategy_key": key,
                "rule": {
                    "trend_states": defs.REGIME_RULES[key]["trend_states"],
                    "volatility_states": defs.REGIME_RULES[key]["volatility_states"],
                    "rule": defs.REGIME_RULES[key]["rule"],
                },
                "compatibility": defs.regime_compatibility(key, regime),
            }
            for key in STRATEGY_FACTORS
        ],
    }
