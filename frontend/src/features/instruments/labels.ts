import { EXCHANGES, INSTRUMENT_TYPES } from '@/lib/enums';

export type Exchange = (typeof EXCHANGES)[number];
export type InstrumentType = (typeof INSTRUMENT_TYPES)[number];

const EXCHANGE_LABELS: Record<Exchange, string> = {
  NSE: 'NSE',
  BSE: 'BSE',
  MCX: 'MCX',
  NSE_FO: 'NSE F&O',
};

const TYPE_LABELS: Record<InstrumentType, string> = {
  EQUITY: 'Equity',
  FUTURES: 'Futures',
  OPTIONS: 'Options',
  ETF: 'ETF',
  INDEX: 'Index',
};

/** Unknown values (a backend enum added later) are shown as sent. */
export const exchangeLabel = (value: string) => EXCHANGE_LABELS[value as Exchange] ?? value;
export const instrumentTypeLabel = (value: string) => TYPE_LABELS[value as InstrumentType] ?? value;
