import { describe, expect, it } from 'vitest';
import type { Execution } from '@/features/backtests/backtest-model';
import { REGISTRY_FIXTURE } from '@/features/strategies/registry-fixture';
import { VALIDATION_REPORT } from './validation-fixture';
import {
  buildValidationSettings,
  emptyValidationDraft,
  gridCombinations,
  histogramBars,
  parseGridValues,
  ruleText,
  unitText,
  trainingOverlap,
  validationDraftFromExecution,
  windowCount,
} from './validation-model';

const momentum = REGISTRY_FIXTURE.find((e) => e.strategy_key === 'momentum')!;
const meanReversion = REGISTRY_FIXTURE.find((e) => e.strategy_key === 'mean_reversion')!;

describe('validation model', () => {
  it('states the backend rule and value in words, per unit', () => {
    const [sharpe, drawdown] = VALIDATION_REPORT.stages.backtest.checks;
    expect(ruleText(sharpe!)).toBe('Sharpe ratio > 0.50');
    expect(ruleText(drawdown!)).toBe('Maximum drawdown < 30.00%');
    expect(unitText('fraction', 0.1234)).toBe('12.34%');
    expect(unitText('count', 10)).toBe('10');
    expect(unitText('p_value', 0.004975)).toBe('0.0050');
    expect(unitText('ratio', null)).toBe('\u2014');
    const wf = VALIDATION_REPORT.stages.walk_forward.checks;
    expect(ruleText(wf[0]!)).toBe('Walk-forward windows \u2265 5');
  });

  it('reads parameter grids as typed', () => {
    expect(parseGridValues('10, 20 ,30', true)).toEqual([10, 20, 30]);
    expect(parseGridValues('', true)).toEqual([]);
    expect(parseGridValues('1.5, 2', false)).toEqual([1.5, 2]);
    expect(parseGridValues('1.5', true)).toBe('"1.5" is not a whole number.');
    expect(parseGridValues('a', false)).toBe('"a" is not a number.');
    expect(parseGridValues('5, 5', true)).toBe('Each value can be given only once.');
    expect(parseGridValues('1,2,3,4,5,6,7,8,9,10,11', true)).toBe('Give at most 10 values.');
    expect(gridCombinations({})).toBe(1);
    expect(gridCombinations({ lookback: [10, 20], entry_threshold: [1, 2, 3] })).toBe(6);
  });

  it('builds the request settings, or says what is wrong', () => {
    const ok = buildValidationSettings(
      { ...emptyValidationDraft(), grid: { lookback: '10, 20' } },
      momentum,
      false,
    );
    expect(ok).toEqual({
      ok: true,
      settings: {
        walk_forward: {
          train_bars: 252,
          validation_bars: 63,
          test_bars: 63,
          step_bars: null,
          parameter_grid: { lookback: [10, 20] },
        },
        regimes: { source: 'rule_based', trend_window: 200, volatility_window: 20 },
        monte_carlo: { simulations: 1000, seed: 42 },
      },
    });
    const bad = buildValidationSettings(
      {
        ...emptyValidationDraft(),
        testBars: '2',
        simulations: '50',
        seed: 'x',
        grid: { entry_threshold: 'abc' },
      },
      meanReversion,
      false,
    );
    expect(bad).toEqual({
      ok: false,
      errors: {
        'v.testBars': 'Enter 5 to 5,000.',
        'v.simulations': 'Enter 100 to 10,000.',
        'v.seed': 'Enter a whole number.',
        'v.grid.entry_threshold': '"abc" is not a number.',
      },
    });
    // A no-code strategy is never searched, whatever was typed.
    const rules = buildValidationSettings(
      { ...emptyValidationDraft(), grid: { lookback: '10' } },
      momentum,
      true,
    );
    expect(rules.ok && rules.settings.walk_forward?.parameter_grid).toEqual({});
  });

  it('counts the windows that fit', () => {
    expect(windowCount(260, { train: 40, validation: 20, test: 20, step: 20 })).toBe(10);
    expect(windowCount(79, { train: 40, validation: 20, test: 20, step: 20 })).toBe(0);
    expect(windowCount(1117, { train: 252, validation: 63, test: 63, step: 63 })).toBe(12);
    expect(VALIDATION_REPORT.stages.walk_forward.windows).toHaveLength(
      windowCount(260, { train: 40, validation: 20, test: 20, step: 20 }),
    );
  });

  it('fills the settings in from an earlier validation', () => {
    const execution = {
      run_settings: {
        walk_forward: {
          train_bars: 40,
          validation_bars: 20,
          test_bars: 20,
          step_bars: 20,
          parameter_grid: { lookback: [5, 10] },
        },
        regimes: { trend_window: 50, volatility_window: 10 },
        monte_carlo: { simulations: 200, seed: 11 },
      },
    } as unknown as Execution;
    expect(validationDraftFromExecution(execution)).toEqual({
      trainBars: '40',
      validationBars: '20',
      testBars: '20',
      stepBars: '',
      grid: { lookback: '5, 10' },
      regimeSource: 'rule_based',
      regimeModelId: '',
      trendWindow: '50',
      volatilityWindow: '10',
      simulations: '200',
      seed: '11',
    });
    const withModel = {
      run_settings: { regimes: { source: 'model', model_id: 'm-7', trend_window: 200 } },
    } as unknown as Execution;
    expect(validationDraftFromExecution(withModel)).toMatchObject({
      regimeSource: 'model',
      regimeModelId: 'm-7',
    });
  });

  it("says whether the dates overlap a model's training period", () => {
    const model = { start: '2020-01-01T00:00:00+05:30', end: '2021-12-31T00:00:00+05:30' };
    expect(trainingOverlap({ start: '2021-06-01', end: '2022-06-01' }, model)).toBe('overlap');
    expect(trainingOverlap({ start: '2022-01-01', end: '2022-06-01' }, model)).toBe('none');
    expect(trainingOverlap({ start: '', end: '2022-06-01' }, model)).toBe('unknown');
    expect(
      trainingOverlap({ start: '2021-06-01', end: '2022-06-01' }, { start: null, end: null }),
    ).toBe('unknown');
  });

  it('labels histogram bins without changing the counts', () => {
    const histogram = VALIDATION_REPORT.stages.monte_carlo.bootstrap!.histograms.cumulative_return;
    const bars = histogramBars(histogram, (a, b) => `${a}-${b}`);
    expect(bars.map((b) => b.value)).toEqual(histogram.counts);
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(200);
    expect(bars[0]!.label).toBe(`${histogram.edges[0]}-${histogram.edges[1]}`);
  });
});
