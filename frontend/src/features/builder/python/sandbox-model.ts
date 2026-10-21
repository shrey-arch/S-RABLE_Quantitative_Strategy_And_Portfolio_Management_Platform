import type { components } from '@/api/schema';

/**
 * Feature 6: custom Python strategies run in the backend's isolated sandbox.
 * Every figure, limit and rule shown in the editor comes from the backend
 * (GET /sandbox/reference, POST /strategies/{id}/test-run); nothing is computed
 * or described here.
 */

type Schemas = components['schemas'];
export type SandboxReference = Schemas['SandboxReference'];
export type TestRunBody = Schemas['TestRunRequest'];
export type TestRun = Schemas['TestRunResponse'];
export type TestRunSignal = Schemas['TestRunSignal'];
export type TestRunBar = Schemas['TestRunBar'];
export type StrategyCodeError = Schemas['StrategyCodeErrorOut'];
export type ExecutionStrategyError = Schemas['StrategyCodeErrorInfo'];

export const ACTIONS = ['BUY', 'SELL', 'EXIT', 'HOLD'] as const;
export type SignalActionName = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<string, string> = {
  BUY: 'Buy',
  SELL: 'Sell',
  EXIT: 'Exit',
  HOLD: 'Hold',
};

/** How the sandbox that ran it is described to the user. */
export const SANDBOX_LABELS: Record<string, string> = {
  docker: 'Docker container',
  process: 'Guarded process',
};

export const SANDBOX_NOTES: Record<string, string> = {
  docker:
    'A locked-down container: no network, a read-only file system, its own memory and CPU caps.',
  process:
    'A separate guarded process: no files, no network, no other processes, with time and memory caps. Start Docker Desktop to use container isolation instead.',
};

export const TEST_RUN_NOTE =
  'A test run is not stored: it does not appear in your backtest history and nothing is traded.';

/** Bars a test run may cover (the backend allows 20 to 2000). */
export const BAR_CHOICES = [100, 200, 500, 1000] as const;
export const DEFAULT_BARS = 200;
/** The cash a test run reports as context.cash (a test run trades nothing). */
export const TEST_RUN_CASH = 100_000;

export interface TestRunDraft {
  instrumentId: string;
  bars: number;
  quantity: string;
  parameters: string;
}

export const emptyTestRun = (): TestRunDraft => ({
  instrumentId: '',
  bars: DEFAULT_BARS,
  quantity: '10',
  parameters: '',
});

export type BuildResult =
  | { ok: true; body: TestRunBody }
  | { ok: false; errors: Record<string, string> };

/** Parameters are typed as `name = value` lines, so no JSON is needed. */
export function parseParameters(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {};
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) {
      return {
        ok: false,
        error: `Line ${index + 1}: write one parameter per line, as name = value.`,
      };
    }
    const name = line.slice(0, at).trim();
    const text_ = line.slice(at + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return { ok: false, error: `Line ${index + 1}: "${name}" is not a parameter name.` };
    }
    if (text_ === 'true' || text_ === 'false') value[name] = text_ === 'true';
    else if (text_ !== '' && Number.isFinite(Number(text_))) value[name] = Number(text_);
    else value[name] = text_;
  }
  return { ok: true, value };
}

export function buildTestRun(draft: TestRunDraft): BuildResult {
  const errors: Record<string, string> = {};
  if (!draft.instrumentId) errors.instrument_id = 'Choose an instrument.';
  const quantity = Number(draft.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    errors.quantity = 'Enter a whole number of shares.';
  }
  const parsed = parseParameters(draft.parameters);
  if (!parsed.ok) errors.parameters = parsed.error;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      instrument_id: draft.instrumentId,
      bars: draft.bars,
      quantity,
      cash: TEST_RUN_CASH,
      parameters: (parsed as { ok: true; value: Record<string, unknown> }).value,
    },
  };
}

/** The line a code error points at, when it is inside the user's code. */
export function errorLine(
  error: StrategyCodeError | ExecutionStrategyError | null | undefined,
): number | null {
  const line = error?.line;
  return typeof line === 'number' && line >= 1 ? line : null;
}

/** One line of the summary shown above the signals. */
export function testRunSummary(run: TestRun): string {
  const changes = run.signals.filter((s) => s.changed).length;
  const actions = run.signals.filter((s) => s.action !== 'HOLD').length;
  return `${run.signals.length} bars, ${actions} signals, ${changes} position changes`;
}

/**
 * Markers for the chart: one per bar where the position changed. The side is the
 * trade that change needs, so closing a long shows as a sell.
 */
export function signalMarkers(
  run: TestRun,
): { time: string; side: 'BUY' | 'SELL'; text: string }[] {
  const markers: { time: string; side: 'BUY' | 'SELL'; text: string }[] = [];
  let held = 0;
  for (const signal of run.signals) {
    if (signal.changed) {
      markers.push({
        time: signal.date,
        side: signal.position > held ? 'BUY' : 'SELL',
        text: `${ACTION_LABELS[signal.action] ?? signal.action} ${signal.position}`,
      });
    }
    held = signal.position;
  }
  return markers;
}
