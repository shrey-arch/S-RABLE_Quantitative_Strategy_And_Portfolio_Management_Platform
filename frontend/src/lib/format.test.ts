import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatINR,
  formatNumber,
  formatPercent,
  humanize,
  MISSING,
  toNumber,
} from './format';

describe('formatINR', () => {
  it('uses Indian digit grouping with 2 decimals', () => {
    expect(formatINR(100000)).toBe('\u20B91,00,000.00');
    expect(formatINR(12345678.9)).toBe('\u20B91,23,45,678.90');
  });

  it('accepts numeric strings (backend decimals)', () => {
    expect(formatINR('2500.5')).toBe('\u20B92,500.50');
  });

  it('formats negatives', () => {
    expect(formatINR(-500)).toBe('-\u20B9500.00');
  });

  it('shows a dash for missing values, never 0', () => {
    expect(formatINR(null)).toBe(MISSING);
    expect(formatINR(undefined)).toBe(MISSING);
    expect(formatINR('')).toBe(MISSING);
    expect(formatINR('abc')).toBe(MISSING);
  });

  it('shows real zero as zero', () => {
    expect(formatINR(0)).toBe('\u20B90.00');
  });
});

describe('formatPercent', () => {
  it('treats input as a fraction by default, 2 dp', () => {
    expect(formatPercent(0.12345)).toBe('12.35%');
  });

  it('accepts values that are already percentages', () => {
    expect(formatPercent(12.345, 'percent')).toBe('12.35%');
  });

  it('missing -> dash, zero -> 0.00%', () => {
    expect(formatPercent(null)).toBe(MISSING);
    expect(formatPercent(0)).toBe('0.00%');
  });
});

describe('formatNumber / toNumber', () => {
  it('formats with Indian grouping', () => {
    expect(formatNumber(1234567.891)).toBe('12,34,567.89');
    expect(formatNumber(5, 0)).toBe('5');
  });

  it('parses numbers and rejects garbage', () => {
    expect(toNumber('1e3')).toBe(1000);
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

describe('dates', () => {
  it('shows date-times in IST', () => {
    expect(formatDateTime('2026-10-14T10:30:00Z')).toBe('14 Oct 2026, 16:00 IST');
  });

  it('rolls over to the next day in IST when needed', () => {
    expect(formatDate('2025-01-31T20:00:00Z')).toBe('01 Feb 2025');
  });

  it('never shifts plain calendar dates', () => {
    expect(formatDate('2025-01-31')).toBe('31 Jan 2025');
  });

  it('missing or invalid -> dash', () => {
    expect(formatDate(null)).toBe(MISSING);
    expect(formatDateTime('not-a-date')).toBe(MISSING);
  });
});

describe('humanize', () => {
  it('turns enum values into readable text', () => {
    expect(humanize('ANGEL_ONE')).toBe('Angel one');
    expect(humanize('COMPLETED')).toBe('Completed');
    expect(humanize(null)).toBe(MISSING);
  });
});
