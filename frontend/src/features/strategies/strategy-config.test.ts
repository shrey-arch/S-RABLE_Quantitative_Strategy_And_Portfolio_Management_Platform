import { describe, expect, it } from 'vitest';
import { conditionText, readConfig } from './strategy-config';

describe('readConfig', () => {
  it('reads a saved StrategyConfig', () => {
    const view = readConfig({
      parameters: { template: 'momentum', lookback: 20, live: false },
      indicators: [{ name: 'sma_fast', type: 'SMA', parameters: { period: 10 } }],
      entry_conditions: [
        {
          left: { type: 'indicator', name: 'sma_fast' },
          operator: '>',
          right: { type: 'value', value: 100 },
        },
      ],
      exit_conditions: [],
    });
    expect(view.parameters).toEqual([
      ['template', 'momentum'],
      ['lookback', 20],
      ['live', false],
    ]);
    expect(view.indicators).toHaveLength(1);
    expect(view.entry.map(conditionText)).toEqual(['sma_fast > 100']);
    expect(view.exit).toEqual([]);
  });

  it('reads price operands and indicator lines', () => {
    const view = readConfig({
      parameters: {},
      indicators: [],
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
        {
          left: { type: 'price', field: 'vwap' },
          operator: '>',
          right: { type: 'value', value: 1 },
        },
      ],
      exit_conditions: [],
    });
    expect(view.entry.map(conditionText)).toEqual(['sma_20 < close', 'macd.macd > macd.signal']);
  });

  it('never throws on an unexpected shape; unreadable parts are left out', () => {
    expect(readConfig(null)).toEqual({ parameters: [], indicators: [], entry: [], exit: [] });
    const view = readConfig({
      parameters: { ok: 1, nested: { a: 1 } },
      indicators: 'nope',
      entry_conditions: [{ left: 1, operator: '>', right: 2 }],
    });
    expect(view.parameters).toEqual([['ok', 1]]);
    expect(view.indicators).toEqual([]);
    expect(view.entry).toEqual([]);
  });
});
