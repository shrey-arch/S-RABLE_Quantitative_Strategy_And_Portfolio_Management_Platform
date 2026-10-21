import type { components } from '@/api/schema';

/**
 * Feature 7: live paper trading. Virtual money, simulated orders, intraday (MIS).
 * Every figure comes from the backend (GET /live/...); this file only shapes the
 * form, labels things and reads the event stream.
 */

type Schemas = components['schemas'];
export type LiveSession = Schemas['LiveSessionOut'];
export type LiveBars = Schemas['LiveBars'];
export type LiveBar = Schemas['Bar'];
export type FormingBar = Schemas['FormingBar'];
export type LiveEvent = Schemas['LiveEvent'];
export type LiveFill = Schemas['LiveFill'];
export type ReplayDay = Schemas['ReplayDay'];
export type LiveStatus = Schemas['LiveStatusOut'];
export type CreateLiveSessionBody = Schemas['CreateLiveSessionRequest'];
export type LiveSessionStatus = LiveSession['status'];

/** The permanent label of every live screen (the backend sends the same text). */
export const LIVE_LABEL = 'Virtual money \u00b7 simulated orders';
export const LIVE_AREA = 'Live Trading (Paper)';
export const MAX_ACTIVE = 3;
export const TIMEFRAMES = ['1M', '5M', '15M'] as const;
export type LiveTimeframe = (typeof TIMEFRAMES)[number];
export const TIMEFRAME_LABELS: Record<LiveTimeframe, string> = {
  '1M': '1 minute',
  '5M': '5 minutes',
  '15M': '15 minutes',
};
export const TIMEFRAME_MINUTES: Record<string, number> = { '1M': 1, '5M': 5, '15M': 15 };
export const SPEEDS = [1, 5, 10] as const;
export type Speed = (typeof SPEEDS)[number];
/** How often lists and a session without a stream are refreshed. */
export const LIVE_POLL_MS = 5_000;

export const OPEN_STATUSES: LiveSessionStatus[] = ['PENDING', 'RUNNING', 'STALE', 'PAUSED'];
export const isOpen = (s: Pick<LiveSession, 'status'>) => OPEN_STATUSES.includes(s.status);
/** A session still has work to do: open, or stopped with a position left for 15:20. */
export const isLiveNow = (s: Pick<LiveSession, 'status' | 'position_qty' | 'squared_off'>) =>
  isOpen(s) || (s.status === 'STOPPED' && s.position_qty !== 0 && !s.squared_off);

export const STATUS_LABELS: Record<LiveSessionStatus, string> = {
  PENDING: 'Starting',
  RUNNING: 'Running',
  STALE: 'Data stale',
  PAUSED: 'Paused',
  STOPPED: 'Stopped',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

export const MODE_LABELS: Record<LiveSession['mode'], string> = {
  DELAYED: 'Delayed live',
  REPLAY: 'Replay',
};

export const REPORT_TEXT =
  'Live testing is done as live paper trading: real NSE market data from Yahoo (15 minutes delayed), simulated orders and virtual money; replay re-runs recorded days.';

// --- data age --------------------------------------------------------------------------

export type AgeTone = 'fresh' | 'late' | 'stale' | 'none';

/**
 * The data-age dot. A closed bar is "fresh" until the next one is due (its
 * timeframe plus the 60-second grace), "late" up to 10 minutes after that, and
 * "stale" beyond, or whenever the backend says the session is STALE.
 */
export function ageTone(
  s: Pick<LiveSession, 'status' | 'data_age_seconds' | 'timeframe'>,
): AgeTone {
  if (s.data_age_seconds === null || s.data_age_seconds === undefined) return 'none';
  if (s.status === 'STALE') return 'stale';
  const due = (TIMEFRAME_MINUTES[s.timeframe] ?? 1) * 60 + 60;
  if (s.data_age_seconds <= due) return 'fresh';
  if (s.data_age_seconds <= due + 600) return 'late';
  return 'stale';
}

export const AGE_LABELS: Record<AgeTone, string> = {
  fresh: 'Data current',
  late: 'Data late',
  stale: 'Data stale',
  none: 'No data yet',
};

export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return 'no bar yet';
  if (seconds < 60) return `${seconds}s old`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s old` : `${m}m old`;
}

// --- times (always IST, never shifted) -----------------------------------------------

const HM = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const HMS = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** "11:15" in IST. */
export const istTime = (iso: string | null | undefined) => (iso ? HM.format(new Date(iso)) : '');
export const istTimeSeconds = (iso: string | null | undefined) =>
  iso ? HMS.format(new Date(iso)) : '';
/** "16 Oct 2026" for a date ("2026-10-16") or a timestamp, in IST. */
export const istDay = (value: string) =>
  DAY.format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value));

/** Seconds since the epoch, for the chart (its axis is labelled in IST). */
export const chartTime = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

// --- events --------------------------------------------------------------------------

export const EVENT_FILTERS = ['all', 'signals', 'orders', 'risk', 'data'] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];
export const EVENT_FILTER_LABELS: Record<EventFilter, string> = {
  all: 'All',
  signals: 'Signals',
  orders: 'Orders',
  risk: 'Risk',
  data: 'Data',
};
const FILTER_KINDS: Record<Exclude<EventFilter, 'all'>, string[]> = {
  signals: ['SIGNAL'],
  orders: ['FILL'],
  risk: ['RISK'],
  data: ['BAR', 'DATA'],
};

/** The log without the per-bar equity lines (they are the equity chart). */
export function filterEvents(events: LiveEvent[], filter: EventFilter): LiveEvent[] {
  if (filter === 'all') return events.filter((e) => e.kind !== 'EQUITY');
  const kinds = FILTER_KINDS[filter];
  return events.filter((e) => kinds.includes(e.kind));
}

export const EVENT_KIND_LABELS: Record<string, string> = {
  BAR: 'Bar',
  SIGNAL: 'Signal',
  FILL: 'Fill',
  RISK: 'Risk',
  DATA: 'Data',
  STATUS: 'Status',
  INFO: 'Info',
  EQUITY: 'Equity',
};

/** One closed bar from a BAR event (the backend's own OHLCV for that bar). */
export function barFromEvent(e: LiveEvent): LiveBar | null {
  const d = e.data as Record<string, unknown>;
  if (e.kind !== 'BAR' || typeof d.bar !== 'string') return null;
  return {
    time: d.bar,
    open: Number(d.open),
    high: Number(d.high),
    low: Number(d.low),
    close: Number(d.close),
    volume: Number(d.volume),
  };
}

/** The equity line: one point per EQUITY event (the backend's figure at that bar). */
export function equityPoints(events: LiveEvent[]): { time: string; value: number }[] {
  return events
    .filter((e) => e.kind === 'EQUITY' && e.market_time)
    .map((e) => ({ time: e.market_time!, value: Number((e.data as { equity: number }).equity) }));
}

/** Add stream events to a list, once each, in id order. */
export function mergeEvents(current: LiveEvent[], incoming: LiveEvent[]): LiveEvent[] {
  if (!incoming.length) return current;
  const seen = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  if (!fresh.length) return current;
  return [...current, ...fresh].sort((a, b) => a.id - b.id);
}

/** Add a bar to the closed bars, replacing one with the same start. */
export function mergeBar(bars: LiveBar[], bar: LiveBar): LiveBar[] {
  // The same instant may be written "...Z" (REST) or "...+00:00" (stream).
  const t = Date.parse(bar.time);
  const at = bars.findIndex((b) => Date.parse(b.time) === t);
  if (at >= 0) return bars.map((b, i) => (i === at ? { ...bar, time: b.time } : b));
  return [...bars, bar].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

// --- the event stream (Server-Sent Events read with fetch) ---------------------------

export interface SseMessage {
  event: string;
  id: number | null;
  data: unknown;
}

/**
 * Splits Server-Sent Events text into messages. Returns the complete messages
 * and the unfinished rest (kept for the next chunk). Comments (heartbeats) are
 * skipped.
 */
export function parseSse(buffer: string): { messages: SseMessage[]; rest: string } {
  const text = buffer.replace(/\r\n/g, '\n');
  const blocks = text.split('\n\n');
  const rest = blocks.pop() ?? '';
  const messages: SseMessage[] = [];
  for (const block of blocks) {
    let event = 'message';
    let id: number | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'id') id = Number(value);
      else if (field === 'data') data.push(value);
    }
    if (!data.length) continue;
    try {
      messages.push({ event, id, data: JSON.parse(data.join('\n')) });
    } catch {
      // A malformed message is skipped; the next snapshot corrects the screen.
    }
  }
  return { messages, rest };
}

// --- the form ------------------------------------------------------------------------

export interface SessionDraft {
  name: string;
  strategyId: string;
  instrumentId: string;
  timeframe: LiveTimeframe;
  mode: 'DELAYED' | 'REPLAY';
  replayDate: string;
  speed: Speed;
  capital: string;
  quantity: string;
  slippageBps: string;
  lossLimitPct: string;
  maxPositionValue: string;
}

export const emptySession = (mode: 'DELAYED' | 'REPLAY' = 'REPLAY'): SessionDraft => ({
  name: '',
  strategyId: '',
  instrumentId: '',
  timeframe: '5M',
  mode,
  replayDate: '',
  speed: 5,
  capital: '200000',
  quantity: '10',
  slippageBps: '5',
  lossLimitPct: '2',
  maxPositionValue: '',
});

const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

export type BuildResult =
  | { ok: true; body: CreateLiveSessionBody }
  | { ok: false; errors: Record<string, string> };

/** Checks the form like the backend does and builds POST /live/sessions. */
export function buildSessionBody(d: SessionDraft, availableCash: number | null): BuildResult {
  const errors: Record<string, string> = {};
  if (!d.strategyId) errors.strategy_id = 'Choose a strategy.';
  if (!d.instrumentId) errors.instrument_id = 'Choose an instrument.';
  if (d.mode === 'REPLAY' && !d.replayDate) errors.replay_date = 'Choose a recorded day.';
  const capital = num(d.capital);
  if (capital === null || !Number.isFinite(capital) || capital <= 0)
    errors.capital = 'Enter the capital for this session.';
  else if (availableCash !== null && capital > availableCash)
    errors.capital = 'More than the paper account has available.';
  const quantity = num(d.quantity);
  if (quantity === null || !Number.isInteger(quantity) || quantity <= 0)
    errors.quantity = 'Enter a whole number of shares.';
  const slippage = num(d.slippageBps);
  if (slippage === null || !Number.isFinite(slippage) || slippage < 0 || slippage > 500)
    errors.slippage_bps = 'Between 0 and 500 basis points.';
  const loss = num(d.lossLimitPct);
  if (loss !== null && (!Number.isFinite(loss) || loss <= 0 || loss > 100))
    errors.loss_limit_pct = 'Between 0 and 100 %, or empty for none.';
  const maxValue = num(d.maxPositionValue);
  if (maxValue !== null && (!Number.isFinite(maxValue) || maxValue <= 0))
    errors.max_position_value = 'A positive amount, or empty for none.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      strategy_id: d.strategyId,
      instrument_id: d.instrumentId,
      name: d.name.trim() || null,
      timeframe: d.timeframe,
      mode: d.mode,
      replay_date: d.mode === 'REPLAY' ? d.replayDate : null,
      speed: d.mode === 'REPLAY' ? d.speed : 1,
      capital: capital!,
      quantity: quantity!,
      slippage_bps: slippage!,
      loss_limit_pct: loss,
      max_position_value: maxValue,
    },
  };
}
