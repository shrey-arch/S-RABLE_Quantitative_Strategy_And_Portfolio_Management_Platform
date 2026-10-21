import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { backendIsUp } from './support/backend';
import { takeTheRunWorker, type Release } from './support/run-worker';

/**
 * Feature 6 gate against the REAL backend and its real sandbox:
 *  1. Parity: a Python copy of the momentum template gives the template's own
 *     trades and final capital, through two real backtests.
 *  2. Hostile code is stopped: a strategy that imports os is refused with the
 *     line, and one that loops forever is stopped by the time limit. Neither
 *     leaves a completed run behind.
 *  3. A Python strategy is written, test-run, backtested and validated from the
 *     website, and then scored on its own results.
 *
 * Needs an active NSE instrument with at least 300 stored daily bars.
 * Skipped when the backend is not on localhost:8000.
 *
 * Each run registers a new user named e2e-<time>@example.com.
 */

const BACKEND = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000';
const PASSWORD = 'E2e-test-pass-123';
const WAIT = { timeout: 30_000 };
const RUN_WAIT = { timeout: 300_000 };
/** Bars the gate's validation runs on: about 6 walk-forward windows. */
const VALIDATION_BARS = 400;
const MIN_BARS = 300;

const MOMENTUM = `import numpy as np


def generate_signal(context):
    lookback = context.params["lookback"]
    closes = context.history("close", lookback)
    if len(closes) < lookback:
        return "HOLD"
    average = float(np.mean(closes))
    if context.bar.close > average:
        return "BUY"
    if context.bar.close < average:
        return "SELL"
    return "HOLD"
`;

const HOSTILE = `import os


def generate_signal(context):
    return "BUY"
`;

const ENDLESS = `def generate_signal(context):
    total = 0
    while True:
        total += 1
    return "HOLD"
`;

test.beforeAll(async ({ request }) => {
  const up = await backendIsUp(request, BACKEND);
  test.skip(!up, `Backend not reachable at ${BACKEND}; start uvicorn to run these.`);
});

test.skip(({ isMobile }) => isMobile, 'Real-API journeys run on desktop only');
// One worker on the server: these run one after another, and a real validation
// of sandboxed code takes minutes.
test.describe.configure({ mode: 'serial', timeout: 600_000 });

// This whole file needs the backend's one run worker, so it waits its turn
// instead of racing another spec file for it (see support/run-worker.ts).
let releaseTheRunWorker: Release | undefined;
test.beforeAll(async () => {
  test.setTimeout(1_800_000); // it may be waiting its turn for the one run worker
  releaseTheRunWorker = await takeTheRunWorker();
});
test.afterAll(async () => {
  await releaseTheRunWorker?.();
});

async function registerAndLogIn(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Python');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/, WAIT);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/, WAIT);
  const token = await page.evaluate(() => sessionStorage.getItem('srable.session'));
  return { Authorization: `Bearer ${token}` };
}

interface Instrument {
  id: string;
  symbol: string;
  exchange: string;
  instrument_type: string;
  is_active: boolean;
}

/** An active NSE instrument with enough stored daily bars to backtest on. */
async function instrumentWithData(request: APIRequestContext, headers: Record<string, string>) {
  const all = (await (
    await request.get(`${BACKEND}/instruments`, { headers })
  ).json()) as Instrument[];
  for (const instrument of all.filter(
    (i) => i.is_active && i.exchange === 'NSE' && ['EQUITY', 'ETF'].includes(i.instrument_type),
  )) {
    const bars = (await (
      await request.get(`${BACKEND}/instruments/${instrument.id}/market-data`, {
        headers,
        params: { timeframe: '1D' },
      })
    ).json()) as { timestamp: string }[];
    if (Array.isArray(bars) && bars.length >= MIN_BARS) {
      // Where to start a validation from, so its walk-forward is a known size
      // whatever this machine has stored. A validation runs one sandbox child per
      // window per candidate - 61 windows over ten years is 122 children, each
      // starting a fresh interpreter - so the gate bounds the span instead of
      // timing out on a slower machine. It still exercises every stage.
      const from = bars[Math.max(0, bars.length - VALIDATION_BARS)]!.timestamp;
      return { ...instrument, validateFrom: from };
    }
  }
  return null;
}

async function saveStrategy(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
  body: Record<string, unknown>,
) {
  const response = await request.post(`${BACKEND}/strategies`, {
    headers,
    data: { name, ...body },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string };
}

const pythonBody = (code: string) => ({
  strategy_type: 'PYTHON',
  strategy_config: { parameters: {}, indicators: [], entry_conditions: [], exit_conditions: [] },
  python_code: code,
});

interface Execution {
  id: string;
  status: string;
  error?: { code?: string; strategy_error?: { line?: number; exception?: string } } | null;
  execution_metrics?: Record<string, unknown> | null;
}

/** POST, waiting while another run holds the one shared worker (409).
 *
 * Looking for a free worker before submitting is not enough on its own: another
 * spec file running at the same time can take it between the look and the post,
 * which is exactly what the backend's 409 says to do something about.
 */
async function postWaitingForTheWorker(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
  data: Record<string, unknown>,
) {
  const deadline = Date.now() + 240_000;
  for (;;) {
    const response = await request.post(`${BACKEND}${path}`, { headers, data });
    if (response.status() !== 409 || Date.now() > deadline) return response;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function runBacktest(
  request: APIRequestContext,
  headers: Record<string, string>,
  data: Record<string, unknown>,
) {
  return postWaitingForTheWorker(request, '/backtests', headers, data);
}

async function waitForRun(
  request: APIRequestContext,
  headers: Record<string, string>,
  id: string,
): Promise<Execution> {
  let execution: Execution = { id, status: 'PENDING' };
  await expect
    .poll(async () => {
      execution = (await (
        await request.get(`${BACKEND}/executions/${id}`, { headers })
      ).json()) as Execution;
      return execution.status;
    }, RUN_WAIT)
    .toMatch(/COMPLETED|FAILED|CANCELLED/);
  return execution;
}

async function waitForCapacity(request: APIRequestContext, headers: Record<string, string>) {
  // The one worker is shared; a 409 means it is busy.
  await expect
    .poll(async () => {
      const response = await request.get(`${BACKEND}/executions`, { headers });
      const runs = (await response.json()) as Execution[];
      return runs.some((r) => r.status === 'RUNNING' || r.status === 'PENDING');
    }, RUN_WAIT)
    .toBe(false);
}

test("Feature 6 gate: a Python copy of the momentum template gives the template's own result", async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active NSE instrument with ${MIN_BARS}+ stored daily bars.`);

  const template = await saveStrategy(page.request, headers, 'Gate: template momentum', {
    strategy_type: 'PYTHON',
    strategy_config: {
      parameters: { template: 'momentum', lookback: 20 },
      indicators: [],
      entry_conditions: [],
      exit_conditions: [],
    },
  });
  const custom = await saveStrategy(
    page.request,
    headers,
    'Gate: Python momentum',
    pythonBody(MOMENTUM),
  );

  const results: Record<string, { trades: unknown[]; final: number; engine: string }> = {};
  for (const [label, strategy, config] of [
    ['template', template, {}],
    ['custom', custom, { lookback: 20 }],
  ] as const) {
    await waitForCapacity(page.request, headers);
    const response = await runBacktest(page.request, headers, {
      strategy_id: strategy.id,
      instrument_id: instrument!.id,
      timeframe: '1D',
      initial_capital: '100000',
      quantity: 7,
      slippage_bps: 5,
      brokerage_rate: 0.0003,
      execution_config: config,
    });
    expect(response.status(), await response.text()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const execution = await waitForRun(page.request, headers, id);
    expect(execution.status, JSON.stringify(execution.error)).toBe('COMPLETED');
    const run = (await (
      await page.request.get(`${BACKEND}/executions/${id}/results`, { headers })
    ).json()) as {
      round_trips: unknown[];
      summary: { final_capital: number };
      configuration: { engine_version: string };
    };
    results[label] = {
      trades: run.round_trips,
      final: run.summary.final_capital,
      engine: run.configuration.engine_version,
    };
  }

  // Parity: the sandboxed copy trades and ends exactly like the built-in template.
  expect(results.custom!.trades.length).toBeGreaterThan(0);
  expect(results.custom!.trades).toEqual(results.template!.trades);
  expect(results.custom!.final).toBe(results.template!.final);
  expect(results.custom!.engine).toBe('1.3');
});

test('Feature 6 gate: hostile code is refused, and an endless loop is stopped', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active NSE instrument with ${MIN_BARS}+ stored daily bars.`);

  // 1. Importing os never reaches a run: it is refused with the line.
  const hostile = await saveStrategy(page.request, headers, 'Gate: hostile', pythonBody(HOSTILE));
  await waitForCapacity(page.request, headers);
  const refused = await runBacktest(page.request, headers, {
    strategy_id: hostile.id,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: '100000',
    quantity: 1,
  });
  expect(refused.status()).toBe(422);
  const detail = ((await refused.json()) as { detail: Record<string, unknown> }).detail;
  expect(detail.code).toBe('STRATEGY_CODE_ERROR');
  expect(detail.line).toBe(1);
  expect(String(detail.message)).toContain('importing os');

  // A test run refuses it the same way, naming the line.
  const testRun = await page.request.post(`${BACKEND}/strategies/${hostile.id}/test-run`, {
    headers,
    data: { instrument_id: instrument!.id, bars: 60 },
  });
  expect(testRun.status()).toBe(422);
  expect(((await testRun.json()) as { detail: { line: number } }).detail.line).toBe(1);

  // 2. An endless loop is stopped by the sandbox's time limit, and the run fails.
  const endless = await saveStrategy(page.request, headers, 'Gate: endless', pythonBody(ENDLESS));
  await waitForCapacity(page.request, headers);
  const submitted = await runBacktest(page.request, headers, {
    strategy_id: endless.id,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: '100000',
    quantity: 1,
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const { id } = (await submitted.json()) as { id: string };
  const execution = await waitForRun(page.request, headers, id);
  expect(execution.status).toBe('FAILED');
  expect(execution.error?.code).toBe('STRATEGY_CODE_ERROR');
  expect(execution.error?.strategy_error?.exception).toBe('Timeout');

  // Neither hostile strategy left a completed run behind.
  const runs = (await (
    await page.request.get(`${BACKEND}/executions`, { headers })
  ).json()) as Execution[];
  expect(runs.filter((r) => r.status === 'COMPLETED')).toHaveLength(0);
});

test('Feature 6 gate: a Python strategy is written, test-run, backtested and validated from the website', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active NSE instrument with ${MIN_BARS}+ stored daily bars.`);

  // Write and save it in the editor.
  await page.goto('/app/builder/new?type=python');
  const editor = page.getByRole('textbox', { name: 'Python code' });
  await expect(editor).toContainText('def generate_signal(context):');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(MOMENTUM);
  await page.getByRole('textbox', { name: 'Name' }).fill('Gate Python momentum');
  await page.getByRole('button', { name: /Create strategy/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Gate Python momentum' })).toBeVisible(
    WAIT,
  );
  const strategyId = page.url().split('/').at(-1)!;

  // Test run it in the real sandbox: signals on real bars, nothing stored.
  await page.getByRole('link', { name: /Edit/ }).click();
  await page.getByLabel('Instrument').selectOption(instrument!.id, WAIT);
  await page.getByLabel('Parameters').fill('lookback = 20');
  await page.getByRole('button', { name: /Test run/ }).click();
  await expect(page.getByTestId('test-run-summary')).toContainText('position changes', WAIT);
  await expect(page.getByTestId('sandbox-kind')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Signals and logs' })).toBeVisible();
  const history = (await (
    await page.request.get(`${BACKEND}/executions`, { headers })
  ).json()) as Execution[];
  expect(history, 'a test run must not be stored').toHaveLength(0);

  // Backtest it from the website.
  await waitForCapacity(page.request, headers);
  const submitted = await runBacktest(page.request, headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: '100000',
    quantity: 5,
    execution_config: { lookback: 20 },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const backtest = await waitForRun(
    page.request,
    headers,
    ((await submitted.json()) as { id: string }).id,
  );
  expect(backtest.status, JSON.stringify(backtest.error)).toBe('COMPLETED');

  // It is now scored on its own results, on the same scale as the templates.
  const scored = (await (
    await page.request.post(`${BACKEND}/scoring`, { headers, data: {} })
  ).json()) as {
    rows: { strategy_id: string; status: string; basis: string; composite_score: number }[];
  };
  const row = scored.rows.find((r) => r.strategy_id === strategyId)!;
  expect(row.status).toBe('SCORED');
  expect(row.basis).toBe('backtest_results');
  expect(row.composite_score).toBeGreaterThanOrEqual(0);
  expect(row.composite_score).toBeLessThanOrEqual(1);

  // Validate it from the website: every stage runs the sandboxed code.
  await waitForCapacity(page.request, headers);
  const validation = await postWaitingForTheWorker(page.request, '/validations', headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    start_timestamp: instrument!.validateFrom,
    initial_capital: '100000',
    quantity: 5,
    execution_config: { lookback: 20 },
    walk_forward: { train_bars: 120, validation_bars: 40, test_bars: 40 },
    regimes: { source: 'rule_based' },
    monte_carlo: { simulations: 200, seed: 1 },
  });
  expect(validation.status(), await validation.text()).toBe(201);
  const report = await waitForRun(
    page.request,
    headers,
    ((await validation.json()) as { id: string }).id,
  );
  expect(report.status).toBe('COMPLETED');
  const stages = (await (
    await page.request.get(`${BACKEND}/validations/${report.id}`, { headers })
  ).json()) as { stages: Record<string, { status: string }>; verdict: { status: string } };
  for (const [name, stage] of Object.entries(stages.stages)) {
    expect(stage.status, `stage ${name}`).not.toBe('ERROR');
  }
  expect(['PASS', 'FAIL']).toContain(stages.verdict.status);
});
