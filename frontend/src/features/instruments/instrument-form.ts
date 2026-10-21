import type { CreateInstrumentBody, Instrument, UpdateInstrumentBody } from './queries';

/** Form values are text, as typed. Limits match the backend's CreateInstrumentRequest. */
export interface InstrumentFormValues {
  symbol: string;
  trading_symbol: string;
  name: string;
  exchange: string;
  instrument_type: string;
  isin: string;
  lot_size: string;
  tick_size: string;
  is_active: boolean;
}

export const LIMITS = { symbol: 50, trading_symbol: 100, name: 255, isin: 20 } as const;

export const EMPTY_FORM: InstrumentFormValues = {
  symbol: '',
  trading_symbol: '',
  name: '',
  exchange: 'NSE',
  instrument_type: 'EQUITY',
  isin: '',
  lot_size: '1',
  tick_size: '0.05',
  is_active: true,
};

export function formFromInstrument(i: Instrument): InstrumentFormValues {
  return {
    symbol: i.symbol,
    trading_symbol: i.trading_symbol,
    name: i.name,
    exchange: i.exchange,
    instrument_type: i.instrument_type,
    isin: i.isin ?? '',
    lot_size: String(i.lot_size),
    tick_size: String(i.tick_size),
    is_active: i.is_active,
  };
}

export const textRule = (label: string, max: number) => (value: string) => {
  const n = value.trim().length;
  if (n === 0) return `Enter the ${label}.`;
  if (n > max) return `Use at most ${max} characters.`;
  return true;
};

export const lotSizeRule = (value: string) =>
  /^\d+$/.test(value.trim()) && Number(value) >= 1 ? true : 'Enter a whole number of 1 or more.';

export const tickSizeRule = (value: string) => {
  const n = Number(value.trim());
  return value.trim() !== '' && Number.isFinite(n) && n > 0 ? true : 'Enter a number above 0.';
};

export function toCreateBody(v: InstrumentFormValues): CreateInstrumentBody {
  return {
    symbol: v.symbol.trim(),
    trading_symbol: v.trading_symbol.trim(),
    name: v.name.trim(),
    exchange: v.exchange as CreateInstrumentBody['exchange'],
    instrument_type: v.instrument_type as CreateInstrumentBody['instrument_type'],
    isin: v.isin.trim() || null,
    lot_size: Number(v.lot_size.trim()),
    tick_size: Number(v.tick_size.trim()),
    is_active: v.is_active,
  };
}

/**
 * Only the fields that changed. The backend treats a missing (null) field as
 * "unchanged", so clearing the ISIN sends an empty string.
 */
export function toUpdateBody(before: Instrument, v: InstrumentFormValues): UpdateInstrumentBody {
  const next = toCreateBody(v);
  const body: UpdateInstrumentBody = {};
  if (next.symbol !== before.symbol) body.symbol = next.symbol;
  if (next.trading_symbol !== before.trading_symbol) body.trading_symbol = next.trading_symbol;
  if (next.name !== before.name) body.name = next.name;
  if (next.exchange !== before.exchange) body.exchange = next.exchange;
  if (next.instrument_type !== before.instrument_type) body.instrument_type = next.instrument_type;
  if ((next.isin ?? '') !== (before.isin ?? '')) body.isin = next.isin ?? '';
  if (next.lot_size !== before.lot_size) body.lot_size = next.lot_size;
  if (next.tick_size !== before.tick_size) body.tick_size = next.tick_size;
  if (next.is_active !== before.is_active) body.is_active = next.is_active;
  return body;
}
