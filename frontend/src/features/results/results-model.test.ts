import { describe, expect, it } from 'vitest';
import { formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { SEEDED_NO_TRADES, SEEDED_TRADES } from './results-fixture';
import {
  downsample,
  metricText,
  metricValue,
  monthLabel,
  monthlyGrid,
  SUMMARY_METRICS,
  toChartPoints,
  TRADE_METRICS,
  tradeMarkers,
  versionChanged,
} from './results-model';

const ALL = [...SUMMARY_METRICS, ...TRADE_METRICS];

describe('metric definitions', () => {
  it('cover every number of the summary and trade statistics, once', () => {
    const shown = ALL.map((m) => m.key);
    expect(new Set(shown).size).toBe(shown.length);
    for (const metric of ALL) {
      const source =
        metric.source === 'summary' ? SEEDED_TRADES.summary : SEEDED_TRADES.trade_stats;
      expect(Object.keys(source), metric.key).toContain(metric.key);
    }
    expect(shown).toEqual(
      expect.arrayContaining([
        'initial_capital',
        'final_capital',
        'net_profit',
        'total_return',
        'cagr',
        'annualized_volatility',
        'max_drawdown',
        'max_drawdown_duration_bars',
        'downside_deviation',
        'sharpe_ratio',
        'sortino_ratio',
        'calmar_ratio',
        'round_trip_count',
        'winning_trades',
        'losing_trades',
        'win_rate',
        'average_gain',
        'average_loss',
        'profit_factor',
        'total_charges',
      ]),
    );
  });

  it('each has a definition and an annualisation basis taken from the API', () => {
    for (const metric of ALL) {
      expect(metric.definition.length, metric.key).toBeGreaterThan(20);
      expect(metric.basis(SEEDED_TRADES.basis).length, metric.key).toBeGreaterThan(10);
    }
    const sharpe = SUMMARY_METRICS.find((m) => m.key === 'sharpe_ratio')!;
    expect(sharpe.basis(SEEDED_TRADES.basis)).toBe(
      'Returns are measured per bar (daily bars). Annualised with 252 bars a year (multiplied by the square root of 252). Risk-free rate 6.50% a year, compounded to 0.0250% per bar.',
    );
    // The basis follows the API, not a number written into the page.
    expect(sharpe.basis({ ...SEEDED_TRADES.basis, periods_per_year: 250 })).toContain(
      '250 bars a year',
    );
    const cagr = SUMMARY_METRICS.find((m) => m.key === 'cagr')!;
    expect(cagr.basis(SEEDED_TRADES.basis)).toContain('365.2425-day years');
  });

  it('values are read straight from the API and formatted, never recalculated', () => {
    const value = (key: string) => metricValue(SEEDED_TRADES, ALL.find((m) => m.key === key)!);
    expect(value('final_capital')).toBe(SEEDED_TRADES.summary.final_capital);
    expect(value('sharpe_ratio')).toBe(SEEDED_TRADES.summary.sharpe_ratio);
    expect(value('average_gain')).toBeNull();
    expect(metricText('money', 9599.16)).toBe(formatINR(9599.16));
    expect(metricText('percent', -0.040084)).toBe('-4.01%');
    expect(metricText('ratio', -10.349473140726081)).toBe('-10.35');
    expect(metricText('count', 2)).toBe('2');
    expect(metricText('bars', 1)).toBe('1 bar');
    expect(metricText('bars', 2)).toBe('2 bars');
    expect(metricText('ratio', null)).toBe(MISSING);
    expect(formatPercent(SEEDED_TRADES.summary.max_drawdown)).toBe('4.96%');
    expect(formatNumber(SEEDED_TRADES.summary.calmar_ratio, 2)).toBe('-20.04');
  });
});

describe('chart data', () => {
  it('uses the trading day (IST) of each point and keeps the later of two on one day', () => {
    const points = toChartPoints(
      [
        { t: '2025-01-06T00:00:00+00:00', v: 1 },
        { t: '2025-01-06T18:00:00+05:30', v: 2 },
        { t: '2025-01-06T18:31:00+00:00', v: 3 },
      ],
      (p) => p.t,
      (p) => p.v,
    );
    expect(points).toEqual([
      { time: '2025-01-06', value: 2 },
      { time: '2025-01-07', value: 3 },
    ]);
  });

  it('draws the seeded equity curve as the API sent it; the last point is the final capital', () => {
    const points = toChartPoints(
      SEEDED_TRADES.equity_curve,
      (p) => p.timestamp,
      (p) => p.portfolio_value,
    );
    expect(points.map((p) => p.value)).toEqual([9999.7, 10099.7, 9899.16, 9599.16]);
    expect(points[points.length - 1]!.value).toBe(SEEDED_TRADES.summary.final_capital);
  });

  it('downsample leaves short series alone', () => {
    const points = Array.from({ length: 2600 }, (_, i) => ({ time: `${i}`, value: i }));
    expect(downsample(points)).toBe(points);
  });

  it('downsample thins long series but keeps the ends, the highest and the lowest point', () => {
    const points = Array.from({ length: 20_000 }, (_, i) => ({
      time: String(i).padStart(6, '0'),
      value: Math.sin(i / 50) * 100 + (i === 12_345 ? -500 : 0) + (i === 777 ? 400 : 0),
    }));
    const out = downsample(points, 5000);
    expect(out.length).toBeLessThanOrEqual(5000);
    expect(out.length).toBeGreaterThan(4000);
    expect(out[0]).toBe(points[0]);
    expect(out[out.length - 1]).toBe(points[points.length - 1]);
    expect(out).toContain(points[12_345]);
    expect(out).toContain(points[777]);
    const times = out.map((p) => p.time);
    expect([...times].sort()).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });

  it('marks BUY and SELL fills of the chosen instrument, in time order', () => {
    const fills = SEEDED_TRADES.records.fills;
    expect(tradeMarkers(fills, fills[0]!.instrument_id)).toEqual([
      { time: '2025-01-06', side: 'BUY', text: 'BUY 10' },
      { time: '2025-01-08', side: 'SELL', text: 'SELL 20' },
    ]);
    expect(tradeMarkers(fills, 'another')).toEqual([]);
  });
});

describe('monthly returns', () => {
  it('lays the API months out by year without adding anything up', () => {
    expect(monthlyGrid(SEEDED_NO_TRADES.monthly_returns)).toEqual([
      { year: '2025', months: [0, 0, ...Array.from({ length: 10 }, () => undefined)] },
    ]);
    const grid = monthlyGrid([
      { month: '2024-12', value: 0.01 },
      { month: '2025-01', value: null },
    ]);
    expect(grid.map((y) => y.year)).toEqual(['2024', '2025']);
    expect(grid[0]!.months[11]).toBe(0.01);
    expect(grid[1]!.months[0]).toBeNull();
    expect(monthLabel('2025-02')).toBe('Feb 2025');
  });
});

describe('versions', () => {
  it('says when the strategy changed after the run', () => {
    expect(versionChanged(SEEDED_TRADES)).toBe(
      'The strategy has changed since this run (it is now v2). These results are for v1.',
    );
    expect(versionChanged(SEEDED_NO_TRADES)).toBeNull();
  });
});
