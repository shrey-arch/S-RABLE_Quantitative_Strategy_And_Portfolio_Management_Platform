import { describe, expect, it } from 'vitest';
import { SCORING_DEFINITIONS } from './scoring-fixture';
import { buildWeights, compareIds, draftFromWeights, rawText, scoreText } from './scoring-model';

const defaults = Object.fromEntries(
  SCORING_DEFINITIONS.strategies.map((s) => [s.strategy_key, s.default_weights]),
);

describe('scoring model helpers', () => {
  it('sends only the weights that differ from the defaults', () => {
    const draft = draftFromWeights(defaults);
    expect(buildWeights(draft, defaults)).toEqual({ ok: true, weights: null });
    draft.momentum = { trend_strength: '3', relative_momentum: '1', volatility_suitability: '0' };
    expect(buildWeights(draft, defaults)).toEqual({
      ok: true,
      weights: { momentum: { trend_strength: 3, relative_momentum: 1, volatility_suitability: 0 } },
    });
  });

  it('checks typed weights before sending', () => {
    const draft = draftFromWeights(defaults);
    draft.momentum = { trend_strength: '-1', relative_momentum: 'x', volatility_suitability: '1' };
    draft.mean_reversion = {
      price_deviation: '0',
      trend_suitability: '0',
      volatility_suitability: '0',
    };
    expect(buildWeights(draft, defaults)).toEqual({
      ok: false,
      errors: {
        'momentum.trend_strength': 'Enter a number of 0 or more.',
        'momentum.relative_momentum': 'Enter a number of 0 or more.',
        mean_reversion: 'At least one weight must be above 0.',
      },
    });
  });

  it('reads at most three strategies to compare from the address', () => {
    expect(compareIds('a,b,a,c,d')).toEqual(['a', 'b', 'c']);
    expect(compareIds(null)).toEqual([]);
  });

  it('formats scores and raw values in their units', () => {
    expect(scoreText(0.83624)).toBe('0.836');
    expect(scoreText(null)).toBe('\u2014');
    expect(rawText('relative_momentum', 0.0123)).toBe('1.23%');
    expect(rawText('price_deviation', -1.23456)).toBe('-1.235');
  });
});
