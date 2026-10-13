from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Instrument


class InstrumentRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
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
        instrument = Instrument(
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

        self.db.add(instrument)
        self.db.commit()
        self.db.refresh(instrument)

        return instrument

    def list(
        self,
        *,
        active_only: bool = False,
    ) -> list[Instrument]:
        statement = select(Instrument)

        if active_only:
            statement = statement.where(Instrument.is_active.is_(True))

        statement = statement.order_by(Instrument.symbol.asc())

        return list(self.db.scalars(statement).all())

    def get_by_id(
        self,
        *,
        instrument_id: UUID,
    ) -> Instrument | None:
        statement = select(Instrument).where(
            Instrument.id == instrument_id
        )

        return self.db.scalar(statement)

    def update(
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
        if symbol is not None:
            instrument.symbol = symbol

        if trading_symbol is not None:
            instrument.trading_symbol = trading_symbol

        if name is not None:
            instrument.name = name

        if exchange is not None:
            instrument.exchange = exchange

        if instrument_type is not None:
            instrument.instrument_type = instrument_type

        if isin is not None:
            instrument.isin = isin

        if lot_size is not None:
            instrument.lot_size = lot_size

        if tick_size is not None:
            instrument.tick_size = tick_size

        if is_active is not None:
            instrument.is_active = is_active

        self.db.commit()
        self.db.refresh(instrument)

        return instrument

    def delete(
        self,
        *,
        instrument: Instrument,
    ) -> None:
        self.db.delete(instrument)
        self.db.commit()
