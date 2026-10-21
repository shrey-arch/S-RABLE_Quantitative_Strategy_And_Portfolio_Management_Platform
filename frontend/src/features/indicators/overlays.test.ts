import { describe, expect, it } from 'vitest';
import { INDICATORS_FIXTURE } from './indicator-fixture';
import { decodeOverlay, encodeOverlay, overlayLabel, toChartOverlay } from './overlays';

describe('chart overlays', () => {
  it('round-trips through the address and fills defaults', () => {
    const macd = { key: 'MACD', parameters: { fast_period: 8, slow_period: 26, signal_period: 9 } };
    expect(encodeOverlay(macd)).toBe('MACD:fast_period=8,slow_period=26,signal_period=9');
    expect(decodeOverlay(encodeOverlay(macd), INDICATORS_FIXTURE)).toEqual(macd);
    expect(decodeOverlay('RSI:', INDICATORS_FIXTURE)).toEqual({
      key: 'RSI',
      parameters: { period: 14 },
    });
    expect(overlayLabel(macd)).toBe('MACD(8, 26, 9)');
  });

  it('ignores unknown types and missing required parameters', () => {
    expect(decodeOverlay('FOO:window=3', INDICATORS_FIXTURE)).toBeNull();
    expect(decodeOverlay('SMA:', INDICATORS_FIXTURE)).toBeNull();
    expect(decodeOverlay('SMA:window=abc', INDICATORS_FIXTURE)).toBeNull();
  });

  it('turns backend points into chart lines on the trading days of the bars', () => {
    const overlay = toChartOverlay(
      { key: 'BOLLINGER', parameters: { window: 20, num_std: 2 } },
      {
        instrument_id: 'x',
        key: 'BOLLINGER',
        panel: 'price',
        parameters: { window: 20, num_std: 2 },
        outputs: ['middle', 'upper', 'lower'],
        points: [
          // 18:30 UTC is midnight IST: the bar is the next calendar day.
          { timestamp: '2026-01-04T18:30:00Z', values: { middle: null, upper: null, lower: null } },
          { timestamp: '2026-01-06T00:00:00Z', values: { middle: 10, upper: 12, lower: 8 } },
        ],
      },
      2,
    );
    expect(overlay.colorIndex).toBe(2);
    expect(overlay.lines.map((l) => l.name)).toEqual(['middle', 'upper', 'lower']);
    expect(overlay.lines[1]!.points).toEqual([
      { time: '2026-01-05', value: null },
      { time: '2026-01-06', value: 12 },
    ]);
  });
});
