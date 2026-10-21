import type { Instrument } from './queries';

/** GET /instruments rows as the backend returns them (used by tests). */
export const instrument = (over: Partial<Instrument> = {}): Instrument => ({
  id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2',
  symbol: 'RELIANCE',
  trading_symbol: 'RELIANCE-EQ',
  name: 'Reliance Industries',
  exchange: 'NSE',
  instrument_type: 'EQUITY',
  isin: 'INE002A01018',
  lot_size: 1,
  tick_size: 0.05,
  is_active: true,
  created_at: '2026-10-16T08:36:00Z',
  updated_at: '2026-10-16T08:36:00Z',
  ...over,
});

export const INSTRUMENTS_FIXTURE: Instrument[] = [
  instrument(),
  instrument({
    id: 'b2c1f0aa-0000-4000-8000-000000000002',
    symbol: 'NIFTYBEES',
    trading_symbol: 'NIFTYBEES-EQ',
    name: 'Nippon India ETF Nifty 50 BeES',
    instrument_type: 'ETF',
    isin: null,
  }),
  instrument({
    id: 'b2c1f0aa-0000-4000-8000-000000000003',
    symbol: 'GOLDM',
    trading_symbol: 'GOLDM-FUT',
    name: 'Gold Mini',
    exchange: 'MCX',
    instrument_type: 'FUTURES',
    isin: null,
    lot_size: 10,
    tick_size: 1,
    is_active: false,
  }),
];
