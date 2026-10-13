from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.instruments import (
    CreateInstrumentRequest,
    InstrumentResponse,
    UpdateInstrumentRequest,
)
from app.services.instruments.instrument_service import InstrumentService


router = APIRouter(
    prefix="/instruments",
    tags=["Instruments"],
)


def _to_response(instrument) -> InstrumentResponse:
    return InstrumentResponse(
        id=instrument.id,
        symbol=instrument.symbol,
        trading_symbol=instrument.trading_symbol,
        name=instrument.name,
        exchange=instrument.exchange,
        instrument_type=instrument.instrument_type,
        isin=instrument.isin,
        lot_size=instrument.lot_size,
        tick_size=instrument.tick_size,
        is_active=instrument.is_active,
        created_at=instrument.created_at,
        updated_at=instrument.updated_at,
    )


@router.post(
    "",
    response_model=InstrumentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_instrument(
    request: CreateInstrumentRequest,
    db: Session = Depends(get_db),
):
    instrument_service = InstrumentService(db)

    try:
        instrument = instrument_service.create_instrument(
            symbol=request.symbol,
            trading_symbol=request.trading_symbol,
            name=request.name,
            exchange=request.exchange,
            instrument_type=request.instrument_type,
            isin=request.isin,
            lot_size=request.lot_size,
            tick_size=request.tick_size,
            is_active=request.is_active,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return _to_response(instrument)


@router.get(
    "",
    response_model=list[InstrumentResponse],
)
def list_instruments(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    instrument_service = InstrumentService(db)

    instruments = instrument_service.list_instruments(
        active_only=active_only,
    )

    return [_to_response(instrument) for instrument in instruments]


@router.get(
    "/{instrument_id}",
    response_model=InstrumentResponse,
)
def get_instrument(
    instrument_id: UUID,
    db: Session = Depends(get_db),
):
    instrument_service = InstrumentService(db)

    instrument = instrument_service.get_instrument(
        instrument_id=instrument_id,
    )

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instrument not found.",
        )

    return _to_response(instrument)


@router.patch(
    "/{instrument_id}",
    response_model=InstrumentResponse,
)
def update_instrument(
    instrument_id: UUID,
    request: UpdateInstrumentRequest,
    db: Session = Depends(get_db),
):
    instrument_service = InstrumentService(db)

    instrument = instrument_service.get_instrument(
        instrument_id=instrument_id,
    )

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instrument not found.",
        )

    try:
        instrument = instrument_service.update_instrument(
            instrument=instrument,
            symbol=request.symbol,
            trading_symbol=request.trading_symbol,
            name=request.name,
            exchange=request.exchange,
            instrument_type=request.instrument_type,
            isin=request.isin,
            lot_size=request.lot_size,
            tick_size=request.tick_size,
            is_active=request.is_active,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return _to_response(instrument)


@router.delete(
    "/{instrument_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_instrument(
    instrument_id: UUID,
    db: Session = Depends(get_db),
):
    instrument_service = InstrumentService(db)

    instrument = instrument_service.get_instrument(
        instrument_id=instrument_id,
    )

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instrument not found.",
        )

    instrument_service.delete_instrument(
        instrument=instrument,
    )
