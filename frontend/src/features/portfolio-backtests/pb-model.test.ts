import { describe, expect, it } from 'vitest';
import { notificationLink } from '@/features/notifications/notification-model';
import { PB_DETAIL, PB_INSTRUMENTS, PB_NOTIFICATION, PB_RESULTS } from './pb-fixture';
import {
  buildRequest,
  draftFrom,
  formatMetric,
  initialDraft,
  pickNifty,
  seriesIn,
  seriesPoints,
  weightRows,
  yearsBefore,
} from './pb-model';

describe('portfolio backtest model', () => {
  it('defaults to the ten years up to today, weekly, with the regime filter', () => {
    const draft = initialDraft('2026-10-18');
    expect(draft).toMatchObject({
      start: '2016-10-18',
      end: '2026-10-18',
      frequency: 'WEEKLY',
      regimeFilter: true,
    });
    expect(yearsBefore('2024-02-29', 10)).toBe('2014-02-28');
  });

  it('builds the request with percents as fractions', () => {
    const draft = {
      ...initialDraft('2026-10-18'),
      strategyIds: ['a', 'b'],
      benchmarkId: 'n',
      cashReservePct: '5',
      maxStrategyPct: '50',
      brokeragePct: '0.03',
      regimeModelId: 'm',
    };
    const { request, errors } = buildRequest(draft, '2026-10-18');
    expect(errors).toEqual({});
    expect(request).toEqual({
      name: 'Core portfolio',
      strategy_ids: ['a', 'b'],
      benchmark_instrument_id: 'n',
      start_date: '2016-10-18',
      end_date: '2026-10-18',
      frequency: 'WEEKLY',
      capital: 1000000,
      brokerage_rate: 0.0003,
      slippage_bps: 5,
      limits: { cash_reserve: 0.05, max_strategy_weight: 0.5, max_asset_weight: 1 },
      regime_filter: true,
      regime_model_id: 'm',
      sixty_forty: false,
      require_validated: false,
    });
    const off = buildRequest({ ...draft, regimeFilter: false, regimeModelId: '' }, '2026-10-18');
    expect(off.request).toMatchObject({ regime_filter: false, regime_model_id: null });
  });

  it('says what is wrong with the form', () => {
    const draft = {
      ...initialDraft('2026-10-18'),
      name: ' ',
      end: '2026-10-20',
      capital: '0',
      cashReservePct: '95',
      maxStrategyPct: '0',
    };
    const { request, errors } = buildRequest(draft, '2026-10-18');
    expect(request).toBeNull();
    expect(errors).toEqual({
      name: 'Give the portfolio backtest a name.',
      strategyIds: 'Choose at least one strategy.',
      benchmarkId: 'Choose the Nifty 50 index.',
      start: 'The end date cannot be in the future.',
      capital: 'Enter an amount above 0.',
      cashReservePct: 'Enter 0 to 90 (%).',
      maxStrategyPct: 'Enter more than 0, up to 100 (%).',
      regimeModelId: 'Choose a regime model, or turn the regime filter off.',
    });
    expect(
      buildRequest({ ...draft, start: '2026-10-18', end: '2026-10-18' }, '2026-10-18').errors.start,
    ).toBe('The end date must be after the start date.');
  });

  it('fills the form in from an earlier run, the left-out strategies too', () => {
    const draft = draftFrom(PB_DETAIL);
    expect(draft.strategyIds).toEqual([
      ...PB_DETAIL.strategies.map((s) => s.strategy_id),
      ...PB_DETAIL.excluded.map((s) => s.strategy_id),
    ]);
    expect(draft).toMatchObject({
      name: PB_DETAIL.name,
      benchmarkId: PB_DETAIL.benchmark_instrument_id,
      start: PB_DETAIL.start_date,
      cashReservePct: '5',
      maxStrategyPct: '50',
      brokeragePct: '0.03',
      regimeModelId: PB_DETAIL.regime_model!.id,
      sixtyForty: true,
    });
    const again = buildRequest(draft, '2026-10-18').request!;
    expect(again.limits).toEqual(PB_DETAIL.limits);
    expect(again.brokerage_rate).toBeCloseTo(PB_DETAIL.brokerage_rate, 12);
  });

  it('picks Nifty 50 among the indices', () => {
    expect(pickNifty(PB_INSTRUMENTS)?.symbol).toBe('NIFTY50');
    expect(pickNifty(PB_INSTRUMENTS.filter((i) => i.instrument_type !== 'INDEX'))).toBeUndefined();
  });

  it('reads the series, drawdowns and weights as the API returns them', () => {
    expect(seriesIn(PB_RESULTS)).toEqual(['portfolio', 'nifty', 'equal_weight', 'sixty_forty']);
    const nifty = seriesPoints(PB_RESULTS, 'nifty');
    expect(nifty).toHaveLength(PB_RESULTS.days.length);
    expect(nifty[5]).toEqual({ time: PB_RESULTS.days[5], value: PB_RESULTS.series.nifty![5] });
    expect(seriesPoints(PB_RESULTS, 'portfolio', 'drawdowns').at(-1)!.value).toBe(
      PB_RESULTS.drawdowns.portfolio!.at(-1),
    );
    const rows = weightRows(PB_RESULTS);
    expect(rows).toHaveLength(PB_RESULTS.rebalance_count);
    for (const row of rows)
      expect(Object.values(row.weights).reduce((a, b) => a + b, 0) + row.cash).toBeCloseTo(1, 9);
  });

  it('formats metrics and shows a dash for a missing one', () => {
    expect(formatMetric(0.0536, 'percent')).toBe('5.36%');
    expect(formatMetric(-0.111, 'ratio')).toBe('-0.11');
    expect(formatMetric(100, 'bars')).toBe('100');
    expect(formatMetric(null, 'ratio')).toBe('\u2014');
  });

  it("links the run's notification to its page", () => {
    expect(PB_NOTIFICATION.message).toBe(`Portfolio backtest "${PB_DETAIL.name}" completed.`);
    expect(notificationLink(PB_NOTIFICATION)).toEqual({
      to: `/app/portfolio-backtests/${PB_DETAIL.id}`,
      label: 'Open portfolio backtest',
    });
  });
});
