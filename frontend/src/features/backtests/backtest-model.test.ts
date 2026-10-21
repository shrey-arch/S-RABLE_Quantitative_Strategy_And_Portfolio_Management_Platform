import { describe, expect, it } from 'vitest';
import { REGISTRY_FIXTURE } from '@/features/strategies/registry-fixture';
import type { Strategy } from '@/features/strategies/queries';
import {
  backtestable,
  barsBeforeFirstSignal,
  buildRequest,
  entryFor,
  RULES_ENTRY,
  draftFromExecution,
  duration,
  emptyDraft,
  fitSlots,
  timeline,
  warmupNote,
  withStrategy,
  type Execution,
} from './backtest-model';
import { VS_STRATEGIES } from '@/features/validation/validation-status-fixture';

// A strategy without a validation, as GET /strategies returns it.
const NOT_VALIDATED = VS_STRATEGIES.find(
  (s) => s.validation.status === 'NOT_VALIDATED',
)!.validation;

const entry = (key: string) => REGISTRY_FIXTURE.find((e) => e.strategy_key === key)!;

const RULES = {
  parameters: {},
  indicators: [{ name: 'sma3', type: 'SMA', parameters: { window: 3 } }],
  entry_conditions: [
    {
      left: { type: 'price', field: 'close' },
      operator: '>',
      right: { type: 'indicator', name: 'sma3', output: 'value' },
    },
  ],
  exit_conditions: [
    {
      left: { type: 'price', field: 'close' },
      operator: '<',
      right: { type: 'indicator', name: 'sma3', output: 'value' },
    },
  ],
};

const strategy = (over: Partial<Strategy> = {}): Strategy => ({
  id: 's1',
  user_id: 'u1',
  name: 'Nifty momentum',
  description: null,
  strategy_type: 'PYTHON',
  strategy_config: {
    parameters: { template: 'momentum', lookback: 50 },
    indicators: [],
    entry_conditions: [],
    exit_conditions: [],
  },
  python_code: null,
  version: 2,
  is_active: true,
  validation: { ...NOT_VALIDATED, current_version: 2 },
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
  ...over,
});

const execution = (over: Partial<Execution> = {}): Execution => ({
  id: 'e1',
  strategy_id: 's1',
  broker_account_id: null,
  instrument_id: 'i1',
  execution_type: 'BACKTEST',
  status: 'PENDING',
  timeframe: '1D',
  initial_capital: 250000,
  execution_config: { lookback: 30 },
  execution_metrics: null,
  run_settings: {
    strategy_key: 'momentum',
    start_timestamp: '2025-01-01T00:00:00+05:30',
    end_timestamp: '2025-06-30T23:59:59+05:30',
    quantity: 5,
    other_instrument_ids: [],
    slippage_bps: 5,
    brokerage_rate: 0.0003,
  },
  error_message: null,
  error: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:00Z',
  ...over,
});

describe('backtest form model', () => {
  it('lists active template, no-code and Python strategies that can run', () => {
    const list = [
      strategy(),
      strategy({ id: 'off', is_active: false }),
      strategy({ id: 'nc', strategy_type: 'NO_CODE', strategy_config: { parameters: {} } }),
      strategy({ id: 'rules', strategy_type: 'NO_CODE', strategy_config: RULES }),
      strategy({
        id: 'rules-off',
        strategy_type: 'NO_CODE',
        strategy_config: RULES,
        is_active: false,
      }),
      strategy({ id: 'py', strategy_config: { parameters: {} }, python_code: 'def x(): pass' }),
      strategy({ id: 'py-empty', strategy_config: { parameters: {} }, python_code: null }),
      strategy({
        id: 'py-off',
        strategy_config: { parameters: {} },
        python_code: 'def x(): pass',
        is_active: false,
      }),
      strategy({ id: 'gone', strategy_config: { parameters: { template: 'retired' } } }),
    ];
    // Feature 6: a Python strategy with saved code runs in the backend's sandbox.
    expect(backtestable(list, REGISTRY_FIXTURE).map((s) => s.id)).toEqual(['s1', 'rules', 'py']);
  });

  it('a no-code strategy runs its saved rules: no parameters, one instrument', () => {
    const rules = strategy({ id: 'rules', strategy_type: 'NO_CODE', strategy_config: RULES });
    expect(entryFor(rules, REGISTRY_FIXTURE)).toBe(RULES_ENTRY);
    const draft = withStrategy(
      {
        ...emptyDraft(),
        instrumentIds: ['i1', 'i2'],
        range: { start: '2025-01-01', end: '2025-06-30' },
      },
      rules,
      RULES_ENTRY,
      { lookback: 30 },
    );
    expect(draft.instrumentIds).toEqual(['i1']);
    expect(draft.params).toEqual({});
    const built = buildRequest(draft, RULES_ENTRY);
    expect(built.ok && built.request).toMatchObject({
      strategy_id: 'rules',
      strategy_key: 'no_code_rules',
      instrument_id: 'i1',
      other_instrument_ids: [],
      execution_config: {},
    });
  });

  it('builds exactly the request the backend expects, with IST day bounds', () => {
    const draft = withStrategy(
      {
        ...emptyDraft(),
        instrumentIds: ['i1'],
        range: { start: '2025-01-01', end: '2025-06-30' },
        capital: '250000.50',
        quantity: '5',
        slippageBps: '5',
        brokeragePct: '0.03',
      },
      strategy(),
      entry('momentum'),
    );
    const built = buildRequest(draft, entry('momentum'));
    expect(built).toEqual({
      ok: true,
      values: { lookback: 50 },
      request: {
        strategy_id: 's1',
        strategy_key: 'momentum',
        instrument_id: 'i1',
        other_instrument_ids: [],
        timeframe: '1D',
        initial_capital: 250000.5,
        start_timestamp: '2025-01-01T00:00:00+05:30',
        end_timestamp: '2025-06-30T23:59:59+05:30',
        execution_config: { lookback: 50 },
        quantity: 5,
        slippage_bps: 5,
        brokerage_rate: 0.0003,
      },
    });
  });

  it('reports every problem with the field it belongs to', () => {
    const draft = {
      ...withStrategy(emptyDraft(), strategy(), entry('momentum')),
      capital: '0',
      quantity: '1.5',
      slippageBps: '2000',
      brokeragePct: '-1',
      params: { lookback: 'ten' },
    };
    const built = buildRequest(draft, entry('momentum'));
    expect(built.ok).toBe(false);
    expect(!built.ok && built.errors).toEqual({
      'instrument.0': 'Choose an instrument.',
      range: 'Choose a start and an end date.',
      capital: 'Enter more than 0.',
      quantity: 'Enter a whole number, 1 or more.',
      slippage: 'Enter at most 1,000.',
      brokerage: 'Enter a number.',
      'param.lookback': 'Enter a whole number.',
    });
  });

  it('a pair needs two different instruments; a universe at least top_k', () => {
    const pair = withStrategy(
      { ...emptyDraft(), instrumentIds: ['a'] },
      strategy({ strategy_config: { parameters: { template: 'statistical_arbitrage' } } }),
      entry('statistical_arbitrage'),
    );
    expect(pair.instrumentIds).toEqual(['a', '']);
    const same = buildRequest(
      { ...pair, instrumentIds: ['a', 'a'] },
      entry('statistical_arbitrage'),
    );
    expect(!same.ok && same.errors['instrument.1']).toBe('Already chosen above. Pick another.');

    const taa = withStrategy(
      emptyDraft(),
      strategy({
        strategy_config: { parameters: { template: 'tactical_asset_allocation', top_k: 3 } },
      }),
      entry('tactical_asset_allocation'),
    );
    expect(taa.instrumentIds).toHaveLength(3);
    expect(fitSlots(['a', 'b', 'c', 'd'], 'universe', { top_k: '2' })).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(fitSlots(['a'], 'single', {})).toEqual(['a']);
    expect(fitSlots(['a', 'b'], 'single', {})).toEqual(['a']);
  });

  it('fills the form back in from an earlier run, parameters included', () => {
    const { draft, overrides } = draftFromExecution(execution());
    expect(draft).toEqual({
      strategyId: 's1',
      instrumentIds: ['i1'],
      range: { start: '2025-01-01', end: '2025-06-30' },
      capital: '250000',
      quantity: '5',
      params: {},
      slippageBps: '5',
      brokeragePct: '0.03',
    });
    expect(withStrategy(draft, strategy(), entry('momentum'), overrides).params).toEqual({
      lookback: '30',
    });
  });

  it('knows the warm-up of each core strategy, as the backend code is written', () => {
    expect(barsBeforeFirstSignal('momentum', { lookback: 20 })).toBe(20);
    expect(barsBeforeFirstSignal('mean_reversion', { lookback: 15 })).toBe(15);
    expect(barsBeforeFirstSignal('statistical_arbitrage', { lookback: 10 })).toBe(10);
    expect(
      barsBeforeFirstSignal('volatility_arbitrage', { short_window: 5, long_window: 20 }),
    ).toBe(21);
    expect(barsBeforeFirstSignal('tactical_asset_allocation', { lookback: 20, top_k: 2 })).toBe(21);
    expect(barsBeforeFirstSignal('new_one', { lookback: 20 })).toBeNull();

    expect(warmupNote(20, 120)).toEqual({
      text: 'The first 19 bars are warm-up: the strategy needs 20 bars before its first signal. 101 of 120 bars can produce signals.',
      insufficient: false,
    });
    expect(warmupNote(20, 12)?.insufficient).toBe(true);
    expect(warmupNote(20, 12)?.text).toMatch(/^Not enough data: 12 bars in this range/);
  });

  it('shows the lifecycle exactly as stored', () => {
    expect(timeline(execution()).map((s) => [s.label, s.state])).toEqual([
      ['Created', 'done'],
      ['Started', 'current'],
      ['Finished', 'upcoming'],
    ]);
    const running = execution({ status: 'RUNNING', started_at: '2026-10-16T09:00:02Z' });
    expect(timeline(running).map((s) => [s.label, s.state, s.at])).toEqual([
      ['Created', 'done', '2026-10-16T09:00:00Z'],
      ['Started', 'done', '2026-10-16T09:00:02Z'],
      ['Finished', 'current', null],
    ]);
    const failedEarly = execution({ status: 'FAILED', completed_at: '2026-10-16T09:00:01Z' });
    expect(timeline(failedEarly).map((s) => [s.label, s.state])).toEqual([
      ['Created', 'done'],
      ['Started', 'skipped'],
      ['Failed', 'done'],
    ]);
    const cancelled = execution({
      status: 'CANCELLED',
      started_at: '2026-10-16T09:00:02Z',
      completed_at: '2026-10-16T09:01:07Z',
    });
    expect(timeline(cancelled).at(-1)).toEqual({
      label: 'Cancelled',
      at: '2026-10-16T09:01:07Z',
      state: 'done',
    });
    expect(duration(cancelled.started_at, cancelled.completed_at)).toBe('1 min 05 s');
    expect(duration('2026-10-16T09:00:00Z', '2026-10-16T09:00:04Z')).toBe('4 s');
    expect(duration('2026-10-16T09:00:00Z', '2026-10-16T09:00:00.400Z')).toBe('under 1 s');
    expect(duration(null, cancelled.completed_at)).toBeNull();
  });
});
