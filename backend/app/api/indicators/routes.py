import math
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.market_data.routes import _bounds, _check_range, _require_instrument
from app.core.dependencies import get_current_user
from app.db import get_db
from app.enums import Timeframe
from app.models import User
from app.quant.indicators.catalogue import (
    INDICATORS,
    IndicatorSpec,
    IndicatorValidationError,
    compute_indicator,
    validate_indicator,
)
from app.schemas.indicators import (
    IndicatorInfo,
    IndicatorParameterInfo,
    IndicatorParameters,
    IndicatorPoint,
    IndicatorSeries,
    IndicatorSeriesRequest,
    IndicatorValidationResult,
)
from app.services.market_data import MarketDataService

router = APIRouter(prefix="/indicators", tags=["Indicators"])
series_router = APIRouter(prefix="/instruments/{instrument_id}/indicators", tags=["Indicators"])


def _info(spec: IndicatorSpec) -> IndicatorInfo:
    return IndicatorInfo(
        key=spec.key,
        name=spec.name,
        category=spec.category,
        panel=spec.panel,
        definition=spec.definition,
        outputs=list(spec.outputs),
        parameters=[
            IndicatorParameterInfo(
                name=p.name,
                type=p.type,
                description=p.description,
                required=p.required,
                default=p.default,
                minimum=p.minimum,
                exclusive_minimum=p.exclusive_minimum,
            )
            for p in spec.parameters
        ],
        rules=list(spec.rules),
        required_columns=list(spec.required_columns),
        used_by=list(spec.used_by),
    )


def _spec_or_404(key: str) -> IndicatorSpec:
    spec = INDICATORS.get(key.upper())
    if spec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Indicator not found.")
    return spec


@router.get("", response_model=list[IndicatorInfo])
def list_indicators(current_user: User = Depends(get_current_user)):
    """Indicator types a strategy configuration may use."""
    return [_info(spec) for spec in INDICATORS.values()]


@router.get("/{key}", response_model=IndicatorInfo)
def get_indicator_info(key: str, current_user: User = Depends(get_current_user)):
    return _info(_spec_or_404(key))


@router.post("/{key}/validate", response_model=IndicatorValidationResult)
def validate_indicator_parameters(
    key: str,
    request: IndicatorParameters,
    current_user: User = Depends(get_current_user),
):
    """Checks parameters the same way saving a strategy does; 422 with the reason."""
    spec = _spec_or_404(key)
    try:
        spec, values = validate_indicator(spec.key, request.parameters)
    except IndicatorValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return IndicatorValidationResult(key=spec.key, parameters=values)


def _clean(value) -> float | None:
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else float(value)


@series_router.post("/{key}", response_model=IndicatorSeries)
def indicator_series(
    instrument_id: UUID,
    key: str,
    request: IndicatorSeriesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    The indicator computed on the instrument's stored daily bars. Bars before
    start_date are used as warm-up, so values match a calculation over the full
    history; one point is returned per stored bar in the range, with the bar's
    timestamp (null while the indicator has too few bars).
    """
    spec = _spec_or_404(key)
    _require_instrument(db, instrument_id)
    _check_range(request.start_date, request.end_date)
    try:
        spec, values = validate_indicator(spec.key, request.parameters)
    except IndicatorValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    _, end = _bounds(None, request.end_date)
    start, _ = _bounds(request.start_date, None)
    rows = MarketDataService(db).list_market_data(
        instrument_id=instrument_id,
        start_timestamp=None,
        end_timestamp=end,
        timeframe=Timeframe.ONE_DAY,
    )
    points: list[IndicatorPoint] = []
    if rows:
        data = pd.DataFrame(
            {
                "open": [r.open for r in rows],
                "high": [r.high for r in rows],
                "low": [r.low for r in rows],
                "close": [r.close for r in rows],
                "volume": [r.volume for r in rows],
            },
            index=[r.timestamp for r in rows],
        )
        frame = compute_indicator(spec, values, data)
        for row, record in zip(rows, frame.itertuples(index=False)):
            if start is not None and row.timestamp < start:
                continue
            points.append(
                IndicatorPoint(
                    timestamp=row.timestamp,
                    values={name: _clean(v) for name, v in zip(spec.outputs, record)},
                )
            )

    return IndicatorSeries(
        instrument_id=str(instrument_id),
        key=spec.key,
        panel=spec.panel,
        parameters=values,
        outputs=list(spec.outputs),
        points=points,
    )
