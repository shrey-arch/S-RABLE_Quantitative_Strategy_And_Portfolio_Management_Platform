import { rangeError, type DateRangeValue } from '@/components/ui/date-range-field';
import { formatDate, formatNumber } from '@/lib/format';
import { istDate, todayIst, useCoverage, type Coverage } from './market-data';

export type DataRangeStatus =
  | { kind: 'no-instrument' }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'no-data'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'incomplete'; message: string }
  | { kind: 'ok'; coverage: Coverage; message: string; warning?: string };

export interface StoredSpan {
  first: string;
  last: string;
}

/** The first and last stored trading day, from coverage of all stored data. */
export const storedSpan = (c: Coverage | undefined): StoredSpan | undefined =>
  c?.first_timestamp && c.last_timestamp
    ? { first: istDate(c.first_timestamp), last: istDate(c.last_timestamp) }
    : undefined;

/** Checks a range that does not need the backend: order, future, stored span. */
export function spanError(value: DateRangeValue, span: StoredSpan, today = todayIst()) {
  const basic = rangeError(value, today);
  if (basic) return basic;
  if (value.start && value.start > span.last)
    return `The start date is after the last stored bar (${formatDate(span.last)}).`;
  if (value.end && value.end < span.first)
    return `The end date is before the first stored bar (${formatDate(span.first)}).`;
  return null;
}

const bars = (n: number) => `${formatNumber(n, 0)} daily ${n === 1 ? 'bar' : 'bars'}`;

/**
 * Whether a date range can be used for this instrument, judged from the backend's
 * coverage: a range is accepted only when stored bars fall inside it. The
 * message names the first and last bar actually in the range, so a range that
 * starts on a holiday or weekend shows the trading day it really starts on.
 */
export function useDataRangeStatus(instrumentId: string, value: DateRangeValue): DataRangeStatus {
  const all = useCoverage(instrumentId, {});
  const span = storedSpan(all.data);
  const complete = Boolean(value.start && value.end);
  const error = span ? spanError(value, span) : null;
  const ask = Boolean(instrumentId && span && complete && !error);
  const inRange = useCoverageWhen(ask, instrumentId, value);

  if (!instrumentId) return { kind: 'no-instrument' };
  if (all.isError) return { kind: 'error', error: all.error };
  if (all.isPending) return { kind: 'loading' };
  if (!span) {
    return {
      kind: 'no-data',
      message: 'No daily data is stored for this instrument. Import it on the instrument page.',
    };
  }
  if (error) return { kind: 'invalid', message: error };
  if (!complete) return { kind: 'incomplete', message: 'Choose a start and an end date.' };
  if (inRange.isError) return { kind: 'error', error: inRange.error };
  if (!inRange.data) return { kind: 'loading' };

  const c = inRange.data;
  if (c.row_count === 0 || !c.first_timestamp || !c.last_timestamp) {
    return { kind: 'invalid', message: 'No stored bars fall in this range. Choose other dates.' };
  }
  const missing = c.trading_days.checked ? c.trading_days.missing_days : 0;
  return {
    kind: 'ok',
    coverage: c,
    message: `${bars(c.row_count)}, ${formatDate(istDate(c.first_timestamp))} to ${formatDate(
      istDate(c.last_timestamp),
    )}.`,
    warning:
      missing > 0
        ? `${formatNumber(missing, 0)} trading ${missing === 1 ? 'day has' : 'days have'} no data in this range.`
        : undefined,
  };
}

/** useCoverage that only asks once the range is worth checking. */
function useCoverageWhen(enabled: boolean, id: string, value: DateRangeValue) {
  // A stable, harmless key while disabled; the query only runs when enabled.
  const range = enabled ? { start: value.start, end: value.end } : { start: '', end: '' };
  return useCoverage(id, range, enabled);
}
