import { describe, expect, it } from 'vitest';
import { REGIME_HISTORY } from './regime-fixture';
import {
  bands,
  buildTrainRequest,
  classColor,
  codeColor,
  CODE_COLORS,
  completeDays,
  dimensionBands,
  emptyTrainDraft,
  WARM_UP_COLOR,
} from './regime-model';
import { SUP_HISTORY } from './supervised-fixture';

const gmm = (id = '') => ({ ...emptyTrainDraft(id), kind: 'GMM' as const });

describe('regime model helpers', () => {
  it('builds a supervised training request by default', () => {
    expect(buildTrainRequest({ ...emptyTrainDraft('i-1'), vixId: 'v-1' })).toEqual({
      ok: true,
      request: {
        model_kind: 'AUTO',
        instrument_id: 'i-1',
        start_date: null,
        end_date: null,
        horizon_days: 20,
        vix_instrument_id: 'v-1',
        random_state: 42,
        volatility_window: 20,
        trend_window: 20,
      },
    });
    expect(
      buildTrainRequest({ ...emptyTrainDraft('i-1'), kind: 'XGB', horizon: '61', vixId: 'i-1' }),
    ).toEqual({
      ok: false,
      errors: {
        horizon: 'Enter 5 to 60.',
        vixId: 'India VIX must be a different instrument from the reference.',
      },
    });
  });

  it('builds the Gaussian-mixture request with the backend defaults', () => {
    expect(buildTrainRequest(gmm('i-1'))).toEqual({
      ok: true,
      request: {
        model_kind: 'GMM',
        instrument_id: 'i-1',
        start_date: null,
        end_date: null,
        volatility_window: 20,
        trend_window: 20,
        candidate_components: [2, 3, 4],
        random_state: 42,
        horizon_days: 20,
      },
    });
    const sorted = buildTrainRequest({
      ...gmm('i-1'),
      components: [5, 2],
      start: '2024-01-01',
    });
    expect(sorted.ok && sorted.request).toMatchObject({
      candidate_components: [2, 5],
      start_date: '2024-01-01',
    });
  });

  it('says what is wrong before anything is sent', () => {
    expect(
      buildTrainRequest({
        ...gmm(),
        start: '2024-02-01',
        end: '2024-01-01',
        volatilityWindow: '2',
        trendWindow: 'x',
        components: [],
        seed: '-1',
      }),
    ).toEqual({
      ok: false,
      errors: {
        instrumentId: 'Choose the reference instrument.',
        range: 'The end date is before the start date.',
        volatilityWindow: 'Enter 5 to 120.',
        trendWindow: 'Enter a whole number.',
        seed: 'Enter a whole number.',
        components: 'Choose at least one cluster count.',
      },
    });
  });

  it('counts the days with complete features', () => {
    expect(completeDays(600, { ...gmm(), volatilityWindow: '20', trendWindow: '30' })).toBe(570);
    expect(completeDays(10, gmm())).toBe(0);
    // Supervised: 252 warm-up days and the horizon at the end.
    expect(completeDays(1100, { ...emptyTrainDraft(), horizon: '20' })).toBe(828);
    expect(completeDays(200, emptyTrainDraft())).toBe(0);
  });

  it('places every period on its own points, in order', () => {
    const placed = bands(REGIME_HISTORY);
    expect(placed).toHaveLength(REGIME_HISTORY.periods.length);
    let next = 0;
    for (const { period, from, to } of placed) {
      expect(from).toBe(next);
      expect(to - from + 1).toBe(period.bars);
      for (const point of REGIME_HISTORY.points.slice(from, to + 1))
        expect(point.regime_id).toBe(period.regime_id);
      next = to + 1;
    }
    expect(next).toBe(REGIME_HISTORY.points.length);
  });

  it('places each dimension band on its own points', () => {
    for (const band of SUP_HISTORY.dimension_periods!) {
      let next = 0;
      for (const placed of dimensionBands(SUP_HISTORY, band.periods)) {
        expect(placed.from).toBe(next);
        expect(placed.to - placed.from + 1).toBe(placed.bars);
        for (const point of SUP_HISTORY.points.slice(placed.from, placed.to + 1))
          expect(point.dimensions?.[band.key] ?? null).toBe(placed.label);
        next = placed.to + 1;
      }
      expect(next).toBe(SUP_HISTORY.points.length);
    }
  });

  it('colours by code, grey for warm-up', () => {
    expect(codeColor('light', 'R1')).toBe(CODE_COLORS.light[0]);
    expect(codeColor('dark', 'R3')).toBe(CODE_COLORS.dark[2]);
    expect(codeColor('light', null)).toBe(WARM_UP_COLOR.light);
    expect(codeColor('light', 'HV-UP-OFF')).toBe(CODE_COLORS.light[0]);
    expect(codeColor('light', 'LV-DN-ON')).toBe(CODE_COLORS.light[4]);
    expect(classColor('dark', 'Risk-off')).toBe(CODE_COLORS.dark[4]);
    expect(classColor('dark', null)).toBe(WARM_UP_COLOR.dark);
  });
});
