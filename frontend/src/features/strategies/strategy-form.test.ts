import { describe, expect, it } from 'vitest';
import { REGISTRY_FIXTURE } from './registry-fixture';
import {
  buildConfig,
  copyName,
  fieldForMessage,
  paramInputs,
  parseParams,
  savedParams,
  templateOf,
} from './strategy-form';

const meanRev = REGISTRY_FIXTURE[1]!;

describe('strategy form helpers', () => {
  it('fills inputs from saved values, falling back to template defaults', () => {
    expect(paramInputs(meanRev)).toEqual({
      lookback: '20',
      entry_threshold: '2',
      exit_threshold: '0',
    });
    expect(paramInputs(meanRev, { lookback: 50 })).toMatchObject({ lookback: '50' });
  });

  it('parses by the registry type, with a message per bad field', () => {
    expect(
      parseParams(meanRev, { lookback: '30', entry_threshold: '1.5', exit_threshold: '0' }),
    ).toEqual({ ok: true, values: { lookback: 30, entry_threshold: 1.5, exit_threshold: 0 } });
    expect(
      parseParams(meanRev, { lookback: '2.5', entry_threshold: 'x', exit_threshold: '' }),
    ).toEqual({
      ok: false,
      errors: {
        lookback: 'Enter a whole number.',
        entry_threshold: 'Enter a number.',
        exit_threshold: 'Enter a value.',
      },
    });
  });

  it('saves the template key with the parameters and keeps other config parts', () => {
    const base = {
      parameters: { template: 'momentum', lookback: 1 },
      indicators: [{ name: 'a', type: 'SMA', parameters: {} }],
      entry_conditions: [],
      exit_conditions: [],
    };
    expect(buildConfig('momentum', { lookback: 40 }, base)).toEqual({
      parameters: { template: 'momentum', lookback: 40 },
      indicators: base.indicators,
      entry_conditions: [],
      exit_conditions: [],
    });
    expect(templateOf(base)).toBe('momentum');
    expect(templateOf({ parameters: {} })).toBeNull();
    expect(savedParams(base)).toEqual({ lookback: 1 });
  });

  it('puts a backend message under the parameter it names first', () => {
    const names = ['short_window', 'long_window'];
    expect(fieldForMessage('short_window must be less than long_window.', names)).toBe(
      'short_window',
    );
    expect(
      fieldForMessage("Parameter 'long_window' for strategy 'x' must be an integer.", names),
    ).toBe('long_window');
    expect(fieldForMessage('Unknown parameters for strategy: speed', names)).toBeNull();
    // Whole names only: "lookback" is not found inside "lookback_days".
    expect(fieldForMessage('lookback_days is wrong', ['lookback'])).toBeNull();
  });

  it('names copies within the 100-character limit', () => {
    expect(copyName('Alpha')).toBe('Alpha (copy)');
    expect(copyName('x'.repeat(100))).toHaveLength(100);
  });
});
