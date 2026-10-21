/**
 * Display formatters used everywhere in the app.
 *
 * - Money: Indian rupees with Indian digit grouping (1,00,000.00)
 * - Percent: 2 decimal places
 * - Dates/times: shown in IST (Asia/Kolkata)
 * - Missing values (null / undefined / not a number) show as an em dash, never as 0
 */

export const MISSING = '\u2014';

const IST = 'Asia/Kolkata';

type NumberLike = number | string | null | undefined;

/** Accepts numbers and numeric strings (the backend may send decimals as strings). */
export function toNumber(value: NumberLike): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 100000 -> "Rs 1,00,000.00" */
export function formatINR(value: NumberLike): string {
  const n = toNumber(value);
  return n === null ? MISSING : inr.format(n);
}

/** 12345.678 -> "12,345.68" */
export function formatNumber(value: NumberLike, decimals = 2): string {
  const n = toNumber(value);
  if (n === null) return MISSING;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/**
 * Percentages to 2 dp.
 * input 'fraction' (default): 0.1234 -> "12.34%"
 * input 'percent':            12.34  -> "12.34%"
 */
export function formatPercent(
  value: NumberLike,
  input: 'fraction' | 'percent' = 'fraction',
): string {
  const n = toNumber(value);
  if (n === null) return MISSING;
  return `${formatNumber(input === 'fraction' ? n * 100 : n, 2)}%`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const isDateOnly = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** "31 Jan 2025". Plain dates ("2025-01-31") are never shifted by timezone. */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return MISSING;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: isDateOnly(value) ? 'UTC' : IST,
  }).format(d);
}

/** "31 Jan 2025, 15:30 IST" */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return MISSING;
  const text = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: IST,
  }).format(d);
  return `${text} IST`;
}

/** "ANGEL_ONE" -> "Angel one" */
export function humanize(value: string | null | undefined): string {
  if (!value) return MISSING;
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
