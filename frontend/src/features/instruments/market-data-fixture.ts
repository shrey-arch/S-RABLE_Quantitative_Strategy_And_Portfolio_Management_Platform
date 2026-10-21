import type { Coverage, ImportResult, MarketDataRow } from './market-data';

/** Daily bars as GET /instruments/{id}/market-data returns them (used by tests). */
export const MARKET_DATA_FIXTURE: MarketDataRow[] = [
  ['2026-10-05', 1360, 1372.5, 1355.2, 1370.1, 5_120_000],
  ['2026-10-06', 1370.1, 1381, 1364, 1377.85, 4_880_000],
  ['2026-10-07', 1377.85, 1379.9, 1351.3, 1356.4, 6_210_000],
  ['2026-10-08', 1356.4, 1368, 1349.75, 1365.25, 0],
  ['2026-10-09', 1365.25, 1390.6, 1362, 1388.05, 7_045_500],
  ['2026-10-12', 1388.05, 1395.4, 1380.15, 1384.3, 5_502_250],
].map(([day, open, high, low, close, volume]) => ({
  timestamp: `${day}T00:00:00Z`,
  open: open as number,
  high: high as number,
  low: low as number,
  close: close as number,
  volume: volume as number,
}));

/** The rows the backend would return for an inclusive IST date range. */
export const rowsBetween = (start?: string, end?: string) =>
  MARKET_DATA_FIXTURE.filter((r) => {
    const day = r.timestamp.slice(0, 10);
    return (!start || day >= start) && (!end || day <= end);
  });

export const coverage = (over: Partial<Coverage> = {}): Coverage => ({
  instrument_id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2',
  timeframe: '1D',
  provider: 'yahoo_finance',
  requested_start: null,
  requested_end: null,
  row_count: 6,
  first_timestamp: '2026-10-05T00:00:00Z',
  last_timestamp: '2026-10-12T00:00:00Z',
  last_imported_at: '2026-10-15T10:30:00Z',
  trading_days: {
    checked: true,
    range_start: '2026-10-05',
    range_end: '2026-10-13',
    expected_days: 7,
    days_with_data: 6,
    missing_days: 1,
    missing_periods: [{ start: '2026-10-13', end: '2026-10-13', days: 1 }],
    missing_periods_truncated: false,
    closed_days_with_data: [],
    holidays_known_for_years: [2026],
    note: null,
  },
  quality: {
    missing_values: {},
    duplicate_timestamps: 0,
    invalid_prices: {},
    zero_volume_rows: 1,
    negative_volume_rows: 0,
  },
  ...over,
});

export const importResult = (over: Partial<ImportResult> = {}): ImportResult => ({
  instrument_id: '31d5a446-1ba0-4f4d-ad0e-d6dddce2b8f2',
  provider: 'yahoo_finance',
  timeframe: '1D',
  start_date: '2026-10-12',
  end_date: '2026-10-16',
  fetched: 4,
  inserted: 3,
  skipped_existing: 1,
  rejected: 0,
  rejected_reasons: {},
  ...over,
});
