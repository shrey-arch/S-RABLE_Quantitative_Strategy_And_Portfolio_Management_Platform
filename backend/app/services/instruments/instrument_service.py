from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.models import Instrument
from app.repositories.instruments.instrument_repository import (
    InstrumentRepository,
)


class InstrumentService:
    def __init__(self, db):
        self.repository = InstrumentRepository(db)

    def create_instrument(
        self,
        *,
        symbol: str,
        trading_symbol: str,
        name: str,
        exchange,
        instrument_type,
        isin: str | None,
        lot_size: int,
        tick_size: float,
        is_active: bool = True,
    ) -> Instrument:
        try:
            return self.repository.create(
                symbol=symbol,
                trading_symbol=trading_symbol,
                name=name,
                exchange=exchange,
                instrument_type=instrument_type,
                isin=isin,
                lot_size=lot_size,
                tick_size=tick_size,
                is_active=is_active,
            )
        except IntegrityError as exc:
            raise ValueError(
                "An instrument with this trading symbol already exists."
            ) from exc

    def list_instruments(
        self,
        *,
        active_only: bool = False,
    ) -> list[Instrument]:
        return self.repository.list(
            active_only=active_only,
        )

    def get_instrument(
        self,
        *,
        instrument_id: UUID,
    ) -> Instrument | None:
        return self.repository.get_by_id(
            instrument_id=instrument_id,
        )

    def get_required_instrument(
        self,
        *,
        instrument_id: UUID,
    ) -> Instrument:
        instrument = self.get_instrument(
            instrument_id=instrument_id,
        )

        if not instrument:
            raise ValueError("Instrument not found.")

        return instrument

    def update_instrument(
        self,
        *,
        instrument: Instrument,
        symbol: str | None = None,
        trading_symbol: str | None = None,
        name: str | None = None,
        exchange=None,
        instrument_type=None,
        isin: str | None = None,
        lot_size: int | None = None,
        tick_size: float | None = None,
        is_active: bool | None = None,
    ) -> Instrument:
        try:
            return self.repository.update(
                instrument=instrument,
                symbol=symbol,
                trading_symbol=trading_symbol,
                name=name,
                exchange=exchange,
                instrument_type=instrument_type,
                isin=isin,
                lot_size=lot_size,
                tick_size=tick_size,
                is_active=is_active,
            )
        except IntegrityError as exc:
            raise ValueError(
                "An instrument with this trading symbol already exists."
            ) from exc

    def delete_instrument(
        self,
        *,
        instrument: Instrument,
    ) -> None:
        self.repository.delete(
            instrument=instrument,
        )