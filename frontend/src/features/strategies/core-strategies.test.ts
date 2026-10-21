import { describe, expect, it } from 'vitest';
import { MISSING } from '@/lib/format';
import { coreInfo, formatParamValue, instrumentNeed } from './core-strategies';
import { REGISTRY_FIXTURE } from './registry-fixture';

describe('core strategies', () => {
  it('has a description for every registry key', () => {
    for (const entry of REGISTRY_FIXTURE) {
      expect(coreInfo(entry.strategy_key).summary).not.toBe('No description yet.');
    }
  });

  it('falls back for a key added to the backend later', () => {
    const info = coreInfo('pairs_v2');
    expect(info.name).toBe('Pairs v2');
    expect(info.summary).toBe('No description yet.');
  });

  it('says how many instruments each strategy backtests on, from the registry', () => {
    const needs = Object.fromEntries(
      REGISTRY_FIXTURE.map((e) => [e.strategy_key, instrumentNeed(e.instruments)]),
    );
    expect(needs).toEqual({
      momentum: 'Runs on one instrument.',
      mean_reversion: 'Runs on one instrument.',
      volatility_arbitrage: 'Runs on one instrument.',
      statistical_arbitrage: 'Runs on two instruments (A and B).',
      tactical_asset_allocation: 'Runs on a group of instruments (at least top_k, and at least 2).',
    });
  });

  it('shows defaults the way the backend types them', () => {
    expect(formatParamValue({ name: 'x', type: 'float', required: false, default: 2 })).toBe('2.0');
    expect(formatParamValue({ name: 'x', type: 'float', required: false, default: 0.5 })).toBe(
      '0.5',
    );
    expect(formatParamValue({ name: 'x', type: 'int', required: false, default: 20 })).toBe('20');
    expect(formatParamValue({ name: 'x', type: 'int', required: true, default: null })).toBe(
      MISSING,
    );
  });
});
