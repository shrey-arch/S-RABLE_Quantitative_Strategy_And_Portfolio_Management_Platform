import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { components } from '@/api/schema';
import { formatDate } from '@/lib/format';

type Schemas = components['schemas'];
export type MarketDataRow = Schemas['MarketDataRow'];
export type Coverage = Schemas['MarketDataCoverage'];
export type ImportResult = Schemas['MarketDataImportResult'];

/** Whole IST days, "YYYY-MM-DD". Either end may be open. */
export interface DateRange {
  start?: string;
  end?: string;
}

const query = (range: DateRange) => ({
  ...(range.start ? { start_date: range.start } : {}),
  ...(range.end ? { end_date: range.end } : {}),
});

/** Stored daily bars (GET /instruments/{id}/market-data), oldest first. */
export function useMarketData(id: string, range: DateRange) {
  return useQuery({
    queryKey: queryKeys.instruments.marketData(id, range),
    queryFn: () =>
      unwrap(
        api.GET('/instruments/{instrument_id}/market-data', {
          params: { path: { instrument_id: id }, query: { timeframe: '1D', ...query(range) } },
        }),
      ),
  });
}

/** Coverage, trading-day gaps and quality checks (GET .../market-data/coverage). */
export function useCoverage(id: string, range: DateRange, enabled = true) {
  return useQuery({
    enabled: enabled && Boolean(id),
    queryKey: queryKeys.instruments.coverage(id, range),
    queryFn: () =>
      unwrap(
        api.GET('/instruments/{instrument_id}/market-data/coverage', {
          params: { path: { instrument_id: id }, query: { timeframe: '1D', ...query(range) } },
        }),
      ),
  });
}

/** Downloads daily bars from the provider; chart and coverage reload afterwards. */
export function useImportMarketData(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (range: { start: string; end: string }) =>
      unwrap(
        api.POST('/instruments/{instrument_id}/market-data/import', {
          params: { path: { instrument_id: id } },
          body: { start_date: range.start, end_date: range.end },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['instruments', 'market-data', id] });
      void queryClient.invalidateQueries({ queryKey: ['instruments', 'coverage', id] });
      void queryClient.invalidateQueries({ queryKey: ['instruments', 'indicator', id] });
    },
  });
}

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The NSE trading day of a bar, "YYYY-MM-DD". Daily bars may be stored at 00:00 UTC
 * or at 00:00 IST; reading the time in IST gives the right day for both
 * (the backend's coverage check does the same).
 */
export function istDate(timestamp: string): string {
  return IST_DATE.format(new Date(timestamp));
}

/** Today in IST, "YYYY-MM-DD". */
export function todayIst(now: Date = new Date()): string {
  return IST_DATE.format(now);
}

export interface Bar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** API rows to chart bars, one per trading day, in the same order as the API. */
export function toBars(rows: MarketDataRow[]): Bar[] {
  return rows.map((r) => ({
    time: istDate(r.timestamp),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

const PROVIDERS: Record<string, string> = { yahoo_finance: 'Yahoo Finance' };
export const providerLabel = (p: string) => PROVIDERS[p] ?? p;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const columnsText = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([column, n]) => `${column} (${plural(n, 'row')})`)
    .join(', ');

/** Plain-language warnings from the backend's checks. Empty when nothing was found. */
export function qualityWarnings(coverage: Coverage): string[] {
  const q = coverage.quality;
  const warnings: string[] = [];
  if (Object.keys(q.missing_values).length) {
    warnings.push(`Missing values: ${columnsText(q.missing_values)}.`);
  }
  if (q.duplicate_timestamps > 0) {
    warnings.push(`${plural(q.duplicate_timestamps, 'timestamp')} appear more than once.`);
  }
  if (Object.keys(q.invalid_prices).length) {
    warnings.push(`Prices at or below zero: ${columnsText(q.invalid_prices)}.`);
  }
  if (q.zero_volume_rows > 0) {
    warnings.push(`${plural(q.zero_volume_rows, 'day')} with zero volume.`);
  }
  if (q.negative_volume_rows > 0) {
    warnings.push(`${plural(q.negative_volume_rows, 'day')} with negative volume.`);
  }
  const closed = coverage.trading_days.closed_days_with_data ?? [];
  if (closed.length) {
    warnings.push(
      `Data on ${plural(closed.length, 'day')} the NSE calendar marks as closed: ${closed
        .map((d) => formatDate(d))
        .join(', ')}.`,
    );
  }
  return warnings;
}

/**
 * The Yahoo provider in the backend handles NSE equities, ETFs and indices (an
 * index named NIFTY50 or INDIAVIX, or with its Yahoo symbol such as ^NSEI).
 */
export const IMPORT_TYPES = ['EQUITY', 'ETF', 'INDEX'] as const;
export const canImport = (i: { exchange: string; instrument_type: string }) =>
  i.exchange === 'NSE' && (IMPORT_TYPES as readonly string[]).includes(i.instrument_type);
