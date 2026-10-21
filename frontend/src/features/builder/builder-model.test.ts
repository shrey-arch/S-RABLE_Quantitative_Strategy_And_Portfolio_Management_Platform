import { describe, expect, it } from 'vitest';
import { INDICATORS_FIXTURE } from '@/features/indicators/indicator-fixture';
import {
  emptyDraft,
  fromStrategy,
  OPERATORS,
  problemPlace,
  outputsByType,
  renameReferences,
  sideSentence,
  toConfig,
  validateDraft,
  type Draft,
} from './builder-model';

const OUTPUTS = outputsByType(INDICATORS_FIXTURE);

const DRAFT: Draft = {
  name: ' Trend + RSI ',
  description: 'Test',
  params: [
    { key: 'quantity', kind: 'integer', value: '10' },
    { key: 'risk', kind: 'float', value: '1.5' },
    { key: 'label', kind: 'string', value: 'nifty' },
    { key: 'short', kind: 'boolean', value: 'false' },
  ],
  indicators: [
    { name: 'sma_20', type: 'SMA', parameters: { window: 20 } },
    {
      name: 'macd',
      type: 'MACD',
      parameters: { fast_period: 12, slow_period: 26, signal_period: 9 },
    },
  ],
  entry: [
    {
      left: { kind: 'indicator', name: 'sma_20', output: '' },
      operator: '<',
      right: { kind: 'price', field: 'close' },
    },
    {
      left: { kind: 'indicator', name: 'macd', output: 'macd' },
      operator: '>',
      right: { kind: 'indicator', name: 'macd', output: 'signal' },
    },
  ],
  exit: [
    {
      left: { kind: 'price', field: 'close' },
      operator: '<=',
      right: { kind: 'value', text: '95.5' },
    },
  ],
};

const CONFIG = {
  parameters: { quantity: 10, risk: 1.5, label: 'nifty', short: false },
  indicators: [
    { name: 'sma_20', type: 'SMA', parameters: { window: 20 } },
    {
      name: 'macd',
      type: 'MACD',
      parameters: { fast_period: 12, slow_period: 26, signal_period: 9 },
    },
  ],
  entry_conditions: [
    {
      left: { type: 'indicator', name: 'sma_20', output: 'value' },
      operator: '<',
      right: { type: 'price', field: 'close' },
    },
    {
      left: { type: 'indicator', name: 'macd', output: 'macd' },
      operator: '>',
      right: { type: 'indicator', name: 'macd', output: 'signal' },
    },
  ],
  exit_conditions: [
    {
      left: { type: 'price', field: 'close' },
      operator: '<=',
      right: { type: 'value', value: 95.5 },
    },
  ],
};

describe('builder model', () => {
  it('offers exactly the five operators of the contract', () => {
    expect([...OPERATORS]).toEqual(['<', '<=', '>', '>=', '==']);
  });

  it('turns a valid draft into the StrategyConfig the backend stores', () => {
    expect(validateDraft(DRAFT, OUTPUTS)).toEqual({});
    // Single-line indicators get their line ("value"), exactly as the backend fills it in.
    expect(toConfig(DRAFT, OUTPUTS)).toEqual(CONFIG);
  });

  it('round-trips: config -> draft -> config is unchanged', () => {
    const { draft, lossy } = fromStrategy({
      name: 'x',
      description: null,
      strategy_config: CONFIG,
    });
    expect(lossy).toBe(false);
    expect(toConfig(draft, OUTPUTS)).toEqual(CONFIG);
  });

  it('flags a saved configuration it cannot fully read', () => {
    const { lossy } = fromStrategy({
      name: 'x',
      description: null,
      strategy_config: { ...CONFIG, entry_conditions: [{ left: 1, operator: '>', right: 2 }] },
    });
    expect(lossy).toBe(true);
  });

  it('needs a name and checks parameter names and values', () => {
    const problems = validateDraft(
      {
        ...emptyDraft(),
        params: [
          { key: '', kind: 'integer', value: '1' },
          { key: '2x', kind: 'integer', value: '1.5' },
          { key: 'template', kind: 'float', value: 'abc' },
          { key: 'a', kind: 'boolean', value: '' },
          { key: 'a', kind: 'string', value: '' },
        ],
      },
      OUTPUTS,
    );
    expect(problems).toEqual({
      name: 'Enter a name.',
      'params.0.key': 'Enter a name.',
      'params.1.key': 'Use letters, digits and _ only, starting with a letter or _.',
      'params.1.value': 'Enter a whole number.',
      'params.2.key':
        '"template" is used by strategies made from a core template; choose another name.',
      'params.2.value': 'Enter a number.',
      'params.3.value': 'Choose true or false.',
      'params.4.key': 'Another parameter has this name.',
    });
  });

  it('rejects references to undefined indicators and missing lines', () => {
    const problems = validateDraft(
      {
        ...DRAFT,
        entry: [
          {
            left: { kind: 'indicator', name: 'ema_9', output: '' },
            operator: '<',
            right: { kind: 'indicator', name: 'macd', output: '' },
          },
        ],
        exit: [
          {
            left: { kind: 'value', text: '1' },
            operator: '<',
            right: { kind: 'value', text: 'x' },
          },
          {
            left: { kind: 'value', text: '1' },
            operator: '<',
            right: { kind: 'value', text: '2' },
          },
        ],
      },
      OUTPUTS,
    );
    expect(problems).toEqual({
      'entry.0.left': 'ema_9 is not defined. Add it in Indicators, or choose another.',
      'entry.0.right': 'Choose a line of macd: macd, signal, histogram.',
      'exit.0.right': 'Enter a number.',
      'exit.1': 'Compare at least one price or indicator.',
    });
  });

  it('rejects indicator types the backend does not offer', () => {
    const problems = validateDraft(
      { ...DRAFT, indicators: [...DRAFT.indicators, { name: 'x', type: 'VWAP', parameters: {} }] },
      OUTPUTS,
    );
    expect(problems['indicators.2']).toBe('VWAP is not an indicator type the backend offers.');
  });

  it('renaming an indicator updates the conditions that use it', () => {
    const renamed = renameReferences(DRAFT, 'sma_20', 'sma_fast');
    expect(renamed.entry[0]!.left).toEqual({ kind: 'indicator', name: 'sma_fast', output: '' });
    expect(renamed.exit).toEqual(DRAFT.exit);
  });

  it('summarises each side in plain English', () => {
    const config = toConfig(DRAFT, OUTPUTS);
    expect(sideSentence('entry', config.entry_conditions)).toBe(
      'Enter when sma_20 < close and macd.macd > macd.signal.',
    );
    expect(sideSentence('exit', config.exit_conditions)).toBe('Exit when close <= 95.5.');
    expect(sideSentence('exit', [])).toBe('No exit conditions.');
  });

  it('names where each problem is', () => {
    expect(problemPlace('name')).toBe('Name');
    expect(problemPlace('params.0.key')).toBe('Parameter 1 name');
    expect(problemPlace('params.2.value')).toBe('Parameter 3 value');
    expect(problemPlace('indicators.1')).toBe('Indicator 2');
    expect(problemPlace('entry.1.right')).toBe('Entry condition 2, right side');
    expect(problemPlace('exit.0')).toBe('Exit condition 1');
  });
});
