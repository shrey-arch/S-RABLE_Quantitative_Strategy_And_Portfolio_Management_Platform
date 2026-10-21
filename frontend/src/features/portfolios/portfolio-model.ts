import type { components } from '@/api/schema';
import { formatPercent } from '@/lib/format';

/**
 * Portfolio orchestration (Phase 14). Every amount, weight, score and trade comes
 * from the API (/portfolio/...); this file only checks what the user types,
 * turns it into request bodies, and names things. Everything is simulated.
 */

type Schemas = components['schemas'];
export type PortfolioSummary = Schemas['PortfolioSummary'];
export type PortfolioAccount = Schemas['PortfolioAccount'];
export type TargetPortfolio = Schemas['TargetPortfolioResponse'];
export type RebalancePlan = Schemas['RebalancePlanResponse'];
export type AssetPrice = Schemas['AssetPrice'];
export type BindingLimit = Schemas['BindingLimit'];
export type TargetRequest = Schemas['TargetPortfolioRequest'];
export type RebalanceRequest = Schemas['PortfolioRebalanceRequest'];
export type StateRequest = Schemas['UpdatePortfolioStateRequest'];
export type CreateRequest = Schemas['CreatePortfolioRequest'];
export type RiskLimits = Schemas['PortfolioRiskLimitsInput'];
export type EndingState = Schemas['EndingState'];

export const PORTFOLIO_TABS = ['overview', 'target', 'rebalance', 'state'] as const;
export type PortfolioTab = (typeof PORTFOLIO_TABS)[number];
export const PORTFOLIO_TAB_LABELS: Record<PortfolioTab, string> = {
  overview: 'Overview',
  target: 'Target allocation',
  rebalance: 'Rebalance plan',
  state: 'Edit and save',
};
export const isPortfolioTab = (value: string | null): value is PortfolioTab =>
  PORTFOLIO_TABS.includes(value as PortfolioTab);

export const CALCULATION_ONLY =
  'Calculation only \u2014 no orders are placed and nothing is saved.';

export const LIMIT_LABELS: Record<string, string> = {
  cash_reserve: 'Cash reserve',
  max_strategy_weight: 'Max strategy weight',
  max_asset_weight: 'Max asset weight',
  max_invested_capital: 'Max invested capital',
};

export const PRICE_SOURCES: Record<string, string> = {
  given: 'Entered',
  holding: 'Holding price',
  latest_close: 'Latest stored close',
};

/** A weight from the API (a fraction as a decimal string) as a percentage. */
export const weightText = (value: string | null | undefined) => formatPercent(value ?? null);

const MONEY = /^\d+(\.\d{1,2})?$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const WHOLE = /^\d+$/;

export const MESSAGES = {
  money: 'Enter an amount of 0 or more, with up to 2 decimals.',
  positive: 'Enter an amount above 0, with up to 2 decimals.',
  percent: 'Enter a percentage from 0 to 100.',
  whole: 'Enter a whole number of 0 or more.',
  asset: 'Enter the asset (its trading symbol).',
  duplicate: 'This asset is listed twice.',
  heldPrice: 'A held asset needs a price above 0.',
  strategies: 'Choose at least one strategy.',
  name: 'Enter a name (up to 100 characters).',
};

type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

/** "30" (percent) -> "0.3" (the fraction the API takes), moving the decimal point. */
export function percentToFraction(text: string): string {
  const [whole = '', frac = ''] = text.trim().split('.');
  const digits = `${whole}${frac}`.padStart(frac.length + 3, '0');
  const point = digits.length - frac.length - 2;
  const out = `${digits.slice(0, point)}.${digits.slice(point)}`.replace(/^0+(?=\d)/, '');
  return out.replace(/0+$/, '').replace(/\.$/, '');
}

/** The risk limits, typed by the user. Percentages are 0-100; money is in rupees. */
export interface LimitsDraft {
  cashReserve: string;
  maxStrategyPct: string;
  maxAssetPct: string;
  maxInvested: string;
}

export const DEFAULT_LIMITS: LimitsDraft = {
  cashReserve: '0',
  maxStrategyPct: '100',
  maxAssetPct: '100',
  maxInvested: '',
};

/** What the target and rebalance calculations share. */
export interface PlanDraft {
  strategyIds: string[];
  /** A regime code of the active regime model, or '' for none. */
  regime: string;
  limits: LimitsDraft;
  /** Feature 5: also allocate strategies without a passing validation (off by default). */
  includeUnvalidated?: boolean;
}

export function parseLimits(draft: LimitsDraft): Result<RiskLimits> {
  const errors: Record<string, string> = {};
  const t = {
    cashReserve: draft.cashReserve.trim(),
    maxStrategyPct: draft.maxStrategyPct.trim(),
    maxAssetPct: draft.maxAssetPct.trim(),
    maxInvested: draft.maxInvested.trim(),
  };
  if (!MONEY.test(t.cashReserve)) errors.cashReserve = MESSAGES.money;
  for (const key of ['maxStrategyPct', 'maxAssetPct'] as const) {
    if (!DECIMAL.test(t[key]) || Number(t[key]) > 100) errors[key] = MESSAGES.percent;
  }
  if (t.maxInvested && !MONEY.test(t.maxInvested)) errors.maxInvested = MESSAGES.money;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      cash_reserve: t.cashReserve,
      max_strategy_weight: percentToFraction(t.maxStrategyPct),
      max_asset_weight: percentToFraction(t.maxAssetPct),
      max_invested_capital: t.maxInvested || null,
    },
  };
}

function planParts(
  plan: PlanDraft,
): Result<Pick<TargetRequest, 'strategy_ids' | 'regime' | 'limits' | 'require_validated'>> {
  const limits = parseLimits(plan.limits);
  const errors: Record<string, string> = limits.ok ? {} : { ...limits.errors };
  if (plan.strategyIds.length === 0) errors.strategies = MESSAGES.strategies;
  if (!limits.ok || Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      strategy_ids: plan.strategyIds,
      regime: plan.regime || null,
      limits: limits.value,
      require_validated: !plan.includeUnvalidated,
    },
  };
}

export function buildTargetBody(capital: string, plan: PlanDraft): Result<TargetRequest> {
  const parts = planParts(plan);
  const errors: Record<string, string> = parts.ok ? {} : { ...parts.errors };
  const c = capital.trim();
  if (!MONEY.test(c) || Number(c) <= 0) errors.capital = MESSAGES.positive;
  if (!parts.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { capital: c, ...parts.value } };
}

/**
 * The rebalance request: the saved cash and holdings, the price of each held
 * asset (typed or prefilled), the plan settings and the minimum trade value.
 * Each held asset is valued and traded at the same price.
 */
export function buildRebalanceBody(
  account: PortfolioAccount,
  prices: Record<string, string>,
  minimumTrade: string,
  plan: PlanDraft,
): Result<RebalanceRequest> {
  const parts = planParts(plan);
  const errors: Record<string, string> = parts.ok ? {} : { ...parts.errors };
  const checked: Record<string, string> = {};
  for (const h of account.holdings) {
    const p = (prices[h.asset] ?? '').trim();
    if (!MONEY.test(p) || Number(p) <= 0) errors[`price.${h.asset}`] = MESSAGES.heldPrice;
    else checked[h.asset] = p;
  }
  const minimum = minimumTrade.trim();
  if (!MONEY.test(minimum)) errors.minimumTrade = MESSAGES.money;
  if (!parts.ok || Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      cash: account.cash,
      holdings: Object.fromEntries(
        account.holdings.map((h) => [h.asset, { quantity: h.quantity, price: checked[h.asset]! }]),
      ),
      prices: checked,
      minimum_trade_value: minimum,
      ...parts.value,
    },
  };
}

/** One editable holding row. `key` keeps React rows stable while the asset is typed. */
export interface HoldingRow {
  key: string;
  asset: string;
  quantity: string;
  price: string;
}

export interface StateDraft {
  cash: string;
  rows: HoldingRow[];
}

let rowCount = 0;
export const newRow = (asset = '', quantity = '', price = ''): HoldingRow => ({
  key: `row-${(rowCount += 1)}`,
  asset,
  quantity,
  price,
});

export function draftFromAccount(account: PortfolioAccount): StateDraft {
  return {
    cash: account.cash,
    rows: account.holdings.map((h) => newRow(h.asset, String(h.quantity), h.price)),
  };
}

/** The state after the rebalance plan's trades (what "apply" puts in the editor). */
export function draftFromEnding(ending: EndingState): StateDraft {
  return {
    cash: ending.cash,
    rows: ending.holdings.map((h) => newRow(h.asset, String(h.quantity), h.price)),
  };
}

/** Checks the edited state; errors are keyed `cash` or `<row key>.<field>`. */
export function buildStateBody(draft: StateDraft): Result<StateRequest> {
  const errors: Record<string, string> = {};
  const cash = draft.cash.trim();
  if (!MONEY.test(cash)) errors.cash = MESSAGES.money;
  const holdings: StateRequest['holdings'] = {};
  const seen = new Set<string>();
  for (const row of draft.rows) {
    const asset = row.asset.trim();
    const quantity = row.quantity.trim();
    const price = row.price.trim();
    if (!asset) errors[`${row.key}.asset`] = MESSAGES.asset;
    else if (seen.has(asset)) errors[`${row.key}.asset`] = MESSAGES.duplicate;
    seen.add(asset);
    if (!WHOLE.test(quantity)) errors[`${row.key}.quantity`] = MESSAGES.whole;
    if (!MONEY.test(price)) errors[`${row.key}.price`] = MESSAGES.money;
    else if (WHOLE.test(quantity) && Number(quantity) > 0 && Number(price) <= 0)
      errors[`${row.key}.price`] = MESSAGES.heldPrice;
    if (asset && !errors[`${row.key}.quantity`] && !errors[`${row.key}.price`])
      holdings[asset] = { quantity: Number(quantity), price };
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { cash, holdings } };
}

export function buildCreateBody(values: {
  name: string;
  description: string;
  capital: string;
}): Result<CreateRequest> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  const capital = values.capital.trim();
  if (!name || name.length > 100) errors.name = MESSAGES.name;
  if (!MONEY.test(capital) || Number(capital) <= 0) errors.capital = MESSAGES.positive;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      description: values.description.trim() || null,
      initial_capital: capital,
    },
  };
}

/**
 * A position's display name: the strategy name the API returned, or for a
 * binding limit that names a strategy by id, that strategy's name.
 */
export function affectedNames(limit: BindingLimit, target: TargetPortfolio): string[] {
  const names = new Map(target.positions.map((p) => [p.strategy, p.name ?? p.strategy]));
  return limit.affected.map((key) => names.get(key) ?? key);
}
