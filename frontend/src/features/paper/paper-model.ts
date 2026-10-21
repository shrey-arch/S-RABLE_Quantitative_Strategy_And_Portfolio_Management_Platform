import type { components } from '@/api/schema';
import { formatDate, formatINR } from '@/lib/format';

type Schemas = components['schemas'];
export type PaperAccount = Schemas['AccountOut'];
export type PaperOrder = Schemas['OrderOut'];
export type PaperFill = Schemas['FillOut'];
export type PaperHolding = Schemas['HoldingOut'];
export type QuoteRow = Schemas['QuoteRow'];
export type Quote = Schemas['QuoteOut'];
export type OrderPreview = Schemas['PreviewOut'];
export type ChargesTable = Schemas['ChargesTable'];
export type OrderBody = Schemas['OrderRequest'];

export const PAPER_LABEL =
  'Paper trading \u00b7 virtual money \u00b7 delayed prices \u00b7 no broker orders';

/** Quotes, the account and orders are refreshed this often while the page is open. */
export const PAPER_POLL_MS = 60_000;

export const SIDES = ['BUY', 'SELL'] as const;
export type Side = (typeof SIDES)[number];
export const ORDER_TYPES = ['MARKET', 'LIMIT', 'SL', 'SL_M'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  MARKET: 'Market',
  LIMIT: 'Limit',
  SL: 'Stop-loss (SL)',
  SL_M: 'Stop-loss market (SL-M)',
};

export const ORDER_TYPE_HELP: Record<OrderType, string> = {
  MARKET: 'Fills at the latest quote, plus slippage on a buy or minus it on a sell.',
  LIMIT: 'Fills when the quote is at or better than your price.',
  SL: 'Waits for the trigger price, then works as a limit order at your price.',
  SL_M: 'Waits for the trigger price, then fills as a market order.',
};

export const LIVE_STATUSES = ['OPEN', 'TRIGGER_PENDING'] as const;
export const isLive = (status: string) => (LIVE_STATUSES as readonly string[]).includes(status);

export const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  TRIGGER_PENDING: 'Trigger pending',
  FILLED: 'Filled',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export const needsPrice = (t: OrderType) => t === 'LIMIT' || t === 'SL';
export const needsTrigger = (t: OrderType) => t === 'SL' || t === 'SL_M';

export const CHARGE_KEYS = ['brokerage', 'stt', 'exchange', 'sebi', 'stamp_duty', 'gst'] as const;
export const CHARGE_LABELS: Record<(typeof CHARGE_KEYS)[number], string> = {
  brokerage: 'Brokerage',
  stt: 'STT',
  exchange: 'Exchange charge',
  sebi: 'SEBI fee',
  stamp_duty: 'Stamp duty',
  gst: 'GST',
};

export interface TicketDraft {
  instrumentId: string;
  side: Side;
  orderType: OrderType;
  quantity: string;
  price: string;
  trigger: string;
}

type Built = { ok: true; body: OrderBody } | { ok: false; errors: Record<string, string> };

const positive = (text: string) => {
  const n = Number(text);
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Checks the ticket the way the backend does (shape only); funds and ticks are the backend's. */
export function buildOrderBody(d: TicketDraft): Built {
  const errors: Record<string, string> = {};
  if (!d.instrumentId) errors.instrument_id = 'Choose an instrument.';
  const qty = Number(d.quantity);
  if (!/^\d+$/.test(d.quantity.trim()) || qty < 1 || qty > 1_000_000)
    errors.quantity = 'Whole number from 1 to 10,00,000.';
  const price = positive(d.price);
  const trigger = positive(d.trigger);
  if (needsPrice(d.orderType) && price === null) errors.price = 'Enter a price above 0.';
  if (needsTrigger(d.orderType) && trigger === null)
    errors.trigger_price = 'Enter a trigger price above 0.';
  if (d.orderType === 'SL' && price !== null && trigger !== null) {
    if (d.side === 'BUY' && trigger > price)
      errors.trigger_price = 'For a buy SL the trigger must be at or below the price.';
    if (d.side === 'SELL' && trigger < price)
      errors.trigger_price = 'For a sell SL the trigger must be at or above the price.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      instrument_id: d.instrumentId,
      side: d.side,
      order_type: d.orderType,
      quantity: qty,
      price: needsPrice(d.orderType) ? price : null,
      trigger_price: needsTrigger(d.orderType) ? trigger : null,
    },
  };
}

export const emptyTicket = (instrumentId = '', side: Side = 'BUY'): TicketDraft => ({
  instrumentId,
  side,
  orderType: 'MARKET',
  quantity: '1',
  price: '',
  trigger: '',
});

/** "Delayed ~15 min" note with the quote's own time. */
export const quoteAge = (q: Quote) => {
  const minutes = Math.floor(q.age_seconds / 60);
  return minutes < 1
    ? 'under a minute old'
    : minutes < 120
      ? `${minutes} min old`
      : 'from the last session';
};

/** NSE equities and ETFs: what the paper account can trade (Yahoo quotes). */
export const tradable = (i: { exchange: string; instrument_type: string }) =>
  i.exchange === 'NSE' && (i.instrument_type === 'EQUITY' || i.instrument_type === 'ETF');

export function placedMessage(order: PaperOrder): string {
  if (order.status === 'FILLED')
    return `${order.side} ${order.quantity} ${order.symbol} filled at ${formatINR(order.average_price)}.`;
  if (order.status === 'REJECTED') return `Order rejected: ${order.status_message ?? ''}`;
  return order.after_market
    ? `Order placed for the session on ${formatDate(order.session_date)} (market closed).`
    : `Order placed: ${order.status === 'OPEN' ? 'open' : 'waiting for its trigger'}.`;
}

// --- strategy deployments (Feature 1, P2 and P3) ------------------------------------

export type PaperDeployment = Schemas['DeploymentOut'];
export type PaperDeploymentDetail = Schemas['DeploymentDetail'];
export type PaperDeploymentDay = Schemas['DeploymentDayOut'];
export type PaperPerformance = Schemas['Performance'];
export type AccountPerformance = Schemas['AccountPerformance'];
export type RunDue = Schemas['RunDueOut'];
export type DeployBody = Schemas['DeployRequest'];
export type JournalBody = Schemas['JournalRequest'];

export const DEPLOYMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  STOPPED: 'Stopped',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

/** Deployments the daily job still trades (ACTIVE) or may trade again (PAUSED). */
export const isRunningDeployment = (status: string) => status === 'ACTIVE' || status === 'PAUSED';

export type DeploymentAction = 'pause' | 'resume' | 'stop';

/** The controls the backend accepts in each status (anything else answers 409). */
export function deploymentActions(status: string): DeploymentAction[] {
  if (status === 'ACTIVE') return ['pause', 'stop'];
  if (status === 'PAUSED') return ['resume', 'stop'];
  return [];
}

export const DEPLOYMENT_ACTION_LABELS: Record<DeploymentAction, string> = {
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
};

export const DEPLOY_NOTE =
  'The daily job (about 16:00 IST, after the NSE close) runs the strategy on the day\u2019s close and places its orders as market orders filled at that close with your slippage and charges. It is long only, trades from the next session and uses only the capital you set aside.';

export interface DeployDraft {
  strategyId: string;
  instrumentIds: string[];
  quantity: string;
  capital: string;
  lossLimitPct: string;
  durationDays: string;
}

export const emptyDeploy = (): DeployDraft => ({
  strategyId: '',
  instrumentIds: [''],
  quantity: '1',
  capital: '100000',
  lossLimitPct: '',
  durationDays: '30',
});

type BuiltDeploy = { ok: true; body: DeployBody } | { ok: false; errors: Record<string, string> };

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

/** Loss limit as a percent of the capital: '' means none; else above 0 and below 100. */
export function lossLimitFraction(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  if (!DECIMAL.test(text.trim())) return undefined;
  const n = Number(text);
  return n > 0 && n < 100 ? Number((n / 100).toPrecision(12)) : undefined;
}

/** Checks the form's shape the way the backend does; funds and strategy fit are the backend's. */
export function buildDeployBody(d: DeployDraft, needsQuantity: boolean): BuiltDeploy {
  const errors: Record<string, string> = {};
  if (!d.strategyId) errors.strategy_id = 'Choose a strategy.';
  const ids = d.instrumentIds.filter(Boolean);
  if (ids.length < d.instrumentIds.length || ids.length === 0)
    errors.instrument_id = 'Choose every instrument.';
  else if (new Set(ids).size < ids.length) errors.instrument_id = 'Choose different instruments.';
  const qty = Number(d.quantity);
  if (needsQuantity && (!WHOLE.test(d.quantity.trim()) || qty < 1 || qty > 1_000_000))
    errors.quantity = 'Whole number from 1 to 10,00,000.';
  const capital = Number(d.capital);
  if (!DECIMAL.test(d.capital.trim()) || capital <= 0) errors.capital = 'Enter an amount above 0.';
  const loss = lossLimitFraction(d.lossLimitPct);
  if (loss === undefined) errors.loss_limit = 'A percent above 0 and below 100, or empty.';
  const days = Number(d.durationDays);
  if (
    d.durationDays.trim() !== '' &&
    (!WHOLE.test(d.durationDays.trim()) || days < 1 || days > 365)
  )
    errors.duration_days = 'Whole number of days from 1 to 365, or empty to run until stopped.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      strategy_id: d.strategyId,
      instrument_id: ids[0]!,
      other_instrument_ids: ids.slice(1),
      quantity: needsQuantity ? qty : 1,
      capital,
      loss_limit: loss ?? null,
      duration_days: d.durationDays.trim() === '' ? null : days,
    },
  };
}

/** "Buy 20 RELIANCE at 1,397.40 (filled)": one order the strategy placed on a day. */
export function dayOrderText(order: Record<string, unknown>): string {
  const side = order.side === 'SELL' ? 'Sell' : 'Buy';
  const price = typeof order.price === 'number' ? ` at ${formatINR(order.price)}` : '';
  const status = String(order.status ?? '').toLowerCase();
  const message = order.message ? ` - ${String(order.message)}` : '';
  return `${side} ${String(order.quantity)} ${String(order.symbol)}${price} (${status})${message}`;
}

/** The journal's tags from "a, b c": trimmed, unique, at most 10 of up to 30 characters. */
export function parseTags(text: string): string[] {
  const tags = text
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 10).map((t) => t.slice(0, 30));
}
