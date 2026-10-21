import { describe, expect, it } from 'vitest';
import {
  PORTFOLIO_ACCOUNT_SAVED,
  PORTFOLIO_REBALANCE,
  PORTFOLIO_TARGET,
  PORTFOLIO_TARGET_LIMITS,
  PORTFOLIO_TARGET_REGIME,
} from './portfolio-fixture';
import {
  buildCreateBody,
  buildRebalanceBody,
  buildStateBody,
  buildTargetBody,
  DEFAULT_LIMITS,
  draftFromAccount,
  draftFromEnding,
  MESSAGES,
  newRow,
  parseLimits,
  percentToFraction,
  type PlanDraft,
} from './portfolio-model';

/** Adds decimal strings exactly (in millionths), as the weights are 6-decimal strings. */
const micros = (values: string[]) =>
  values.reduce((sum, v) => {
    const [w, f = ''] = v.split('.');
    return sum + BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, '0').slice(0, 6));
  }, 0n);

const PLAN: PlanDraft = { strategyIds: ['s1', 's2'], regime: 'R1', limits: DEFAULT_LIMITS };

describe('portfolio model', () => {
  it('weights plus cash add up to exactly 100% in every API answer', () => {
    for (const t of [PORTFOLIO_TARGET, PORTFOLIO_TARGET_LIMITS, PORTFOLIO_TARGET_REGIME]) {
      expect(micros([...Object.values(t.strategy_weights), t.cash_weight])).toBe(1_000_000n);
      expect(micros([...Object.values(t.asset_weights), t.cash_weight])).toBe(1_000_000n);
    }
    const a = PORTFOLIO_ACCOUNT_SAVED;
    expect(micros([...Object.values(a.allocation_weights), a.cash_weight])).toBe(1_000_000n);
    expect(a.holdings.map((h) => h.weight)).toEqual(Object.values(a.allocation_weights));
  });

  it('turns typed percentages into the fractions the API takes', () => {
    expect(percentToFraction('30')).toBe('0.3');
    expect(percentToFraction('100')).toBe('1');
    expect(percentToFraction('7.5')).toBe('0.075');
    expect(percentToFraction('0')).toBe('0');
    expect(percentToFraction('12.345')).toBe('0.12345');
  });

  it('checks the risk limits', () => {
    expect(parseLimits(DEFAULT_LIMITS)).toEqual({
      ok: true,
      value: {
        cash_reserve: '0',
        max_strategy_weight: '1',
        max_asset_weight: '1',
        max_invested_capital: null,
      },
    });
    expect(
      parseLimits({
        cashReserve: '-1',
        maxStrategyPct: '120',
        maxAssetPct: 'x',
        maxInvested: '1.234',
      }),
    ).toEqual({
      ok: false,
      errors: {
        cashReserve: MESSAGES.money,
        maxStrategyPct: MESSAGES.percent,
        maxAssetPct: MESSAGES.percent,
        maxInvested: MESSAGES.money,
      },
    });
  });

  it('asks for validated strategies only, unless unvalidated ones are included', () => {
    const on = buildTargetBody('1000', PLAN);
    const off = buildTargetBody('1000', { ...PLAN, includeUnvalidated: true });
    expect(on.ok && on.value.require_validated).toBe(true);
    expect(off.ok && off.value.require_validated).toBe(false);
  });

  it('builds the target request, or says what is missing', () => {
    expect(buildTargetBody(' 500000 ', PLAN)).toEqual({
      ok: true,
      value: {
        capital: '500000',
        strategy_ids: ['s1', 's2'],
        regime: 'R1',
        limits: {
          cash_reserve: '0',
          max_strategy_weight: '1',
          max_asset_weight: '1',
          max_invested_capital: null,
        },
        require_validated: true,
      },
    });
    expect(buildTargetBody('0', { ...PLAN, strategyIds: [], regime: '' })).toEqual({
      ok: false,
      errors: { capital: MESSAGES.positive, strategies: MESSAGES.strategies },
    });
  });

  it('builds the rebalance request from the saved state and the prices', () => {
    const a = PORTFOLIO_ACCOUNT_SAVED;
    const prices = { 'RELIANCE-EQ': '130.00', 'NIFTYBEES-EQ': '280.50' };
    const built = buildRebalanceBody(a, prices, '1000', PLAN);
    expect(built).toEqual({
      ok: true,
      value: {
        cash: a.cash,
        holdings: {
          'RELIANCE-EQ': { quantity: a.holdings[0]!.quantity, price: '130.00' },
          'NIFTYBEES-EQ': { quantity: a.holdings[1]!.quantity, price: '280.50' },
        },
        prices,
        minimum_trade_value: '1000',
        strategy_ids: ['s1', 's2'],
        regime: 'R1',
        limits: {
          cash_reserve: '0',
          max_strategy_weight: '1',
          max_asset_weight: '1',
          max_invested_capital: null,
        },
        require_validated: true,
      },
    });
    expect(buildRebalanceBody(a, { 'RELIANCE-EQ': '0' }, 'x', PLAN)).toEqual({
      ok: false,
      errors: {
        'price.RELIANCE-EQ': MESSAGES.heldPrice,
        'price.NIFTYBEES-EQ': MESSAGES.heldPrice,
        minimumTrade: MESSAGES.money,
      },
    });
  });

  it('the rebalance result becomes the state to save, unchanged', () => {
    const ending = PORTFOLIO_REBALANCE.ending_state!;
    expect(buildStateBody(draftFromEnding(ending))).toEqual({
      ok: true,
      value: {
        cash: ending.cash,
        holdings: Object.fromEntries(
          ending.holdings.map((h) => [h.asset, { quantity: h.quantity, price: h.price }]),
        ),
      },
    });
    const saved = draftFromAccount(PORTFOLIO_ACCOUNT_SAVED);
    expect(saved.cash).toBe(PORTFOLIO_ACCOUNT_SAVED.cash);
    expect(saved.rows.map((r) => [r.asset, r.quantity, r.price])).toEqual(
      PORTFOLIO_ACCOUNT_SAVED.holdings.map((h) => [h.asset, String(h.quantity), h.price]),
    );
  });

  it('checks edited holdings before saving', () => {
    const rows = [newRow('AAA', '2', '10'), newRow('AAA', '1.5', '10'), newRow('', '3', '0')];
    expect(buildStateBody({ cash: '-5', rows })).toEqual({
      ok: false,
      errors: {
        cash: MESSAGES.money,
        [`${rows[1]!.key}.asset`]: MESSAGES.duplicate,
        [`${rows[1]!.key}.quantity`]: MESSAGES.whole,
        [`${rows[2]!.key}.asset`]: MESSAGES.asset,
        [`${rows[2]!.key}.price`]: MESSAGES.heldPrice,
      },
    });
    expect(buildStateBody({ cash: '10', rows: [newRow(' BBB ', '0', '0')] })).toEqual({
      ok: true,
      value: { cash: '10', holdings: { BBB: { quantity: 0, price: '0' } } },
    });
  });

  it('checks a new portfolio', () => {
    expect(buildCreateBody({ name: ' Core ', description: ' ', capital: '100000' })).toEqual({
      ok: true,
      value: { name: 'Core', description: null, initial_capital: '100000' },
    });
    expect(buildCreateBody({ name: '', description: '', capital: '0' })).toEqual({
      ok: false,
      errors: { name: MESSAGES.name, capital: MESSAGES.positive },
    });
  });
});
