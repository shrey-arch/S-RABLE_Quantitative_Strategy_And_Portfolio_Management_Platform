import { readFileSync } from 'node:fs';
import { backendIsUp } from './support/backend';
import { takeTheRunWorker, type Release } from './support/run-worker';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { formatINR, formatNumber, formatPercent } from '../../src/lib/format';
import { scoreText } from '../../src/features/scoring/scoring-model';
import {
  formatMetric,
  METRIC_ROWS,
  RELATIVE_ROWS,
  seriesIn,
  type PortfolioBacktestResults,
} from '../../src/features/portfolio-backtests/pb-model';

/**
 * Phase 9 gate against the REAL backend and its real backtest worker:
 * - submit from the form -> the run reaches COMPLETED, and the page shows the
 *   lifecycle exactly as GET /executions/{id} states it, also after a reload;
 * - a double-click on Submit creates one job;
 * - a forced failure shows the backend's error code;
 * - cancel stops a run and it stays CANCELLED.
 * Phase 10 gate: the results page of a real run shows, on all five tabs, exactly
 * what GET /executions/{id}/results returns (and the CSV export holds its rows).
 * Phase 10.5 gate: a no-code strategy made of rules is backtested from the form,
 * long only, and its results show the rules it ran with.
 * Phase 11 gate: a validation started from a backtest's results shows every stage
 * with the backend's pass/fail evidence, and the same seed reproduces Monte Carlo.
 * Phase 12 gate: a regime model trained from the website becomes the active model,
 * and the page and dashboard show exactly the regime the backend returns.
 * Phase 13 gate: two template strategies backtested on real data are ranked, broken
 * down and compared on the scoring page exactly as POST /scoring and their results
 * return them.
 * Phase 14 gate: a portfolio is created, allocated, rebalanced and saved from the
 * website, and each page shows what /portfolio/target, /portfolio/rebalance and
 * /portfolio/accounts/{id} return; a reload shows the saved state.
 * Phase 15 gate: a completed backtest has stored orders, trades and positions; the
 * results page links to them, Trading Records lists them with their chain, and an
 * invalid order status change shows the backend's 400 reason.
 * Phase 16 gate: a finished backtest notifies its owner; the bell shows the
 * backend's unread count, marking read updates it, and the notification opens the
 * run's results.
 * Feature 5 gate: a strategy without a passing validation of its current version is
 * never allocated unless the switch is on, and the page shows the reason exactly as
 * the API returns it.
 * Feature 4 gate: a portfolio backtest of about ten years, rebalanced weekly against
 * the Nifty 50 index, completes in the worker; every number on its page equals
 * GET /portfolio-backtests/{id}/results, also after a reload.
 *
 * Needs one active instrument with at least 80 stored daily bars (import some on
 * an instrument page first). Skipped when the backend is not on localhost:8000.
 *
 * Each run registers a new user named e2e-<time>@example.com in the database.
 * Clean up any time with:  DELETE FROM users WHERE email LIKE 'e2e-%@example.com';
 */

const BACKEND = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000';
const PASSWORD = 'E2e-test-pass-123';
// Pages and requests of the real backend; generous for a busy laptop or a remote database.
const BACKEND_WAIT = { timeout: 60_000 };
const MIN_BARS = 80;

test.beforeAll(async ({ request }) => {
  const up = await backendIsUp(request, BACKEND);
  test.skip(!up, `Backend not reachable at ${BACKEND}; start uvicorn to run these.`);
});

test.skip(({ isMobile }) => isMobile, 'Real-API journeys run on desktop only');
// One backtest worker on the server: these run one after another. A real run on a
// laptop (worker start, years of daily bars, results) can take minutes, so each test
// may take up to 7 minutes and a run up to 5 minutes to finish.
test.describe.configure({ mode: 'serial', timeout: 420_000 });

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
const RUN_WAIT = { timeout: 300_000 };

async function registerAndLogIn(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Backtest');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/, BACKEND_WAIT);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/, BACKEND_WAIT);
  const token = await page.evaluate(() => sessionStorage.getItem('srable.session'));
  return { Authorization: `Bearer ${token}` };
}

type Headers = Record<string, string>;
interface Execution {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error: { code: string | null; message: string | null } | null;
}

/** An active instrument with enough stored daily bars, and its first and last day (IST). */
async function instrumentWithData(
  request: APIRequestContext,
  headers: Headers,
  minBars: number = MIN_BARS,
) {
  const list = (await (await request.get(`${BACKEND}/instruments`, { headers })).json()) as {
    id: string;
    symbol: string;
    is_active: boolean;
  }[];
  for (const instrument of list.filter((i) => i.is_active)) {
    const c = (await (
      await request.get(`${BACKEND}/instruments/${instrument.id}/market-data/coverage`, {
        headers,
        params: { timeframe: '1D' },
      })
    ).json()) as {
      row_count: number;
      first_timestamp: string | null;
      last_timestamp: string | null;
    };
    if (c.row_count >= minBars && c.first_timestamp && c.last_timestamp) {
      const day = (t: string) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(t));
      return {
        ...instrument,
        first: day(c.first_timestamp),
        last: day(c.last_timestamp),
        bars: c.row_count,
      };
    }
  }
  return null;
}

type WithData = NonNullable<Awaited<ReturnType<typeof instrumentWithData>>>;

/** The form, filled in for the whole stored range, up to the Review step. */
async function fillAndReview(page: Page, strategyId: string, instrument: WithData) {
  await page.goto(`/app/backtests/new?strategy=${strategyId}`);
  await expect(page.getByRole('combobox', { name: 'Strategy' })).toHaveValue(
    strategyId,
    BACKEND_WAIT,
  );
  await page.getByRole('combobox', { name: 'Instrument' }).selectOption(instrument.id);
  await page.getByLabel('From', { exact: true }).fill(instrument.first);
  await page.getByLabel('To', { exact: true }).fill(instrument.last);
  await expect(page.getByText(/daily bars?, /).first()).toBeVisible(BACKEND_WAIT);
  await page.getByRole('textbox', { name: 'Slippage (bps)' }).fill('5');
  await page.getByRole('textbox', { name: 'Brokerage (%)' }).fill('0.03');
  await page.getByRole('button', { name: /Review backtest/ }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toBeVisible(BACKEND_WAIT);
}

async function momentumStrategy(request: APIRequestContext, headers: Headers) {
  const response = await request.post(`${BACKEND}/strategies`, {
    headers,
    data: {
      name: 'Gate: momentum backtest',
      strategy_type: 'PYTHON',
      strategy_config: {
        parameters: { template: 'momentum', lookback: 10 },
        indicators: [],
        entry_conditions: [],
        exit_conditions: [],
      },
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function getExecution(request: APIRequestContext, headers: Headers, id: string) {
  const response = await request.get(`${BACKEND}/executions/${id}`, { headers });
  expect(response.ok()).toBe(true);
  return (await response.json()) as Execution;
}

/** POST /backtests (or /validations) straight to the backend, waiting while another run holds the worker (409). */
async function submitDirect(
  request: APIRequestContext,
  headers: Headers,
  data: object,
  path = '/backtests',
) {
  const deadline = Date.now() + 240_000;
  for (;;) {
    const response = await request.post(`${BACKEND}${path}`, { headers, data });
    if (response.status() !== 409 || Date.now() > deadline) {
      expect(response.status()).toBe(201);
      return (await response.json()) as Execution;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const formatTime = (value: string) =>
  `${new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))} IST`;

test('submit from the form: one job, COMPLETED, shown exactly as the backend states it', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active instrument with ${MIN_BARS}+ stored daily bars.`);
  const strategyId = await momentumStrategy(page.request, headers);

  await fillAndReview(page, strategyId, instrument!);

  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/backtests') posts.push(r.url());
  });
  await page.getByRole('button', { name: /Submit backtest/ }).dblclick();
  await expect(page).toHaveURL(/\/app\/backtests\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const id = page.url().split('/').pop()!;

  await expect(page.getByText(/^Status: /)).toHaveText(
    'Status: Completed. This is final.',
    RUN_WAIT,
  );
  expect(posts).toHaveLength(1);

  // What the page shows = what the backend stores.
  const stored = await getExecution(page.request, headers, id);
  expect(stored.status).toBe('COMPLETED');
  const steps = page.getByRole('list', { name: 'Timeline' }).getByRole('listitem');
  await expect(steps).toHaveText([
    `Created (done)${formatTime(stored.created_at)}`,
    `Started (done)${formatTime(stored.started_at!)}`,
    `Completed (done)${formatTime(stored.completed_at!)}`,
  ]);

  // Re-entry by address after a refresh.
  await page.reload();
  await expect(page.getByText(/^Status: /)).toHaveText(
    'Status: Completed. This is final.',
    BACKEND_WAIT,
  );
  await expect(page.getByRole('region', { name: 'Configuration' })).toContainText(
    instrument!.symbol,
  );

  // The history lists it, linked to its page.
  await page.goto('/app/executions');
  const row = page.getByRole('table', { name: 'Backtests' }).getByRole('row').nth(1);
  await expect(row).toContainText('Completed', BACKEND_WAIT);
  await expect(row.getByRole('link').first()).toHaveAttribute('href', `/app/backtests/${id}`);

  const mine = (await (
    await page.request.get(`${BACKEND}/executions`, { headers })
  ).json()) as Execution[];
  expect(mine.map((e) => e.id)).toEqual([id]);
});

test('a forced failure shows the backend error code', async ({ page }) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active instrument with ${MIN_BARS}+ stored daily bars.`);
  const strategyId = await momentumStrategy(page.request, headers);

  // Dates long before any stored data: the worker fails while loading data.
  const run = await submitDirect(page.request, headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: 100000,
    start_timestamp: '1990-01-01T00:00:00+05:30',
    end_timestamp: '1990-03-31T23:59:59+05:30',
  });
  await page.goto(`/app/backtests/${run.id}`);
  await expect(page.getByText(/^Status: /)).toHaveText('Status: Failed. This is final.', RUN_WAIT);
  const stored = await getExecution(page.request, headers, run.id);
  expect(stored.error?.code).toMatch(/^BACKTEST_/);
  const why = page.getByRole('region', { name: 'Why it failed' });
  await expect(why).toContainText(stored.error!.code!);
  await expect(why).toContainText(stored.error!.message!);
});

test('cancel stops a run and it stays cancelled', async ({ page }) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active instrument with ${MIN_BARS}+ stored daily bars.`);
  const strategyId = await momentumStrategy(page.request, headers);

  // Submit, then cancel at once: the worker process is still starting (PENDING)
  // or has just begun (RUNNING).
  await fillAndReview(page, strategyId, instrument!);
  await page.getByRole('button', { name: /Submit backtest/ }).click();
  await expect(page).toHaveURL(/\/app\/backtests\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const run = { id: page.url().split('/').pop()! };
  await page.getByRole('button', { name: /Cancel backtest/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel backtest' }).click();

  const final = page.getByText(/^Status: /);
  await expect(final).toHaveText(/This is final\.$/, BACKEND_WAIT);
  const stored = await getExecution(page.request, headers, run.id);
  // If the worker finished first the backend answers 409 and the page shows how it really ended.
  await expect(final).toHaveText(
    `Status: ${stored.status === 'CANCELLED' ? 'Cancelled' : 'Completed'}. This is final.`,
  );
  if (stored.status === 'CANCELLED') {
    await page.waitForTimeout(3000);
    expect((await getExecution(page.request, headers, run.id)).status).toBe('CANCELLED');
    await page.reload();
    await expect(final).toHaveText('Status: Cancelled. This is final.', BACKEND_WAIT);
  }
});

interface Results {
  summary: Record<string, number | string | null>;
  trade_stats: Record<string, number | null>;
  null_reasons: Record<string, string>;
  equity_curve: { portfolio_value: number }[];
  round_trips: { entry_timestamp: string; net_pnl: number | null }[];
  records: { fills: unknown[] };
  configuration: { engine_version: string | null; strategy_version: number | null };
  provenance: { datasets: { data_fingerprint: string | null; row_count: number | null }[] };
}

test('results of a real run: all five tabs show what GET /results returns', async ({ page }) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active instrument with ${MIN_BARS}+ stored daily bars.`);
  const strategyId = await momentumStrategy(page.request, headers);
  const run = await submitDirect(page.request, headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: 100000,
    start_timestamp: `${instrument!.first}T00:00:00+05:30`,
    end_timestamp: `${instrument!.last}T23:59:59+05:30`,
    execution_config: { lookback: 10 },
    quantity: 1,
    slippage_bps: 5,
    brokerage_rate: 0.0003,
  });
  await expect
    .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
    .toBe('COMPLETED');
  const response = await page.request.get(`${BACKEND}/executions/${run.id}/results`, { headers });
  expect(response.ok()).toBe(true);
  const r = (await response.json()) as Results;
  const last = r.equity_curve[r.equity_curve.length - 1]!.portfolio_value;
  expect(r.summary.final_capital).toBe(last);

  // From the run page to its results.
  await page.goto(`/app/backtests/${run.id}`);
  await page.getByRole('link', { name: /View results/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/executions/${run.id}/results$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Backtest results' })).toBeVisible();
  await expect(page.getByText('Historical simulation', { exact: true })).toBeVisible();

  // Summary: the displayed numbers are the API's.
  const tile = (label: string) => page.getByRole('group', { name: label, exact: true });
  await expect(tile('Final capital')).toContainText(formatINR(last), BACKEND_WAIT);
  await expect(tile('Initial capital')).toContainText(formatINR(100000));
  await expect(tile('Net profit')).toContainText(formatINR(r.summary.net_profit as number));
  await expect(tile('Total return')).toContainText(formatPercent(r.summary.total_return as number));
  for (const [label, key] of [
    ['Sharpe ratio', 'sharpe_ratio'],
    ['Sortino ratio', 'sortino_ratio'],
    ['Calmar ratio', 'calmar_ratio'],
  ] as const) {
    const value = r.summary[key] as number | null;
    await expect(tile(label)).toContainText(
      value === null ? r.null_reasons[key]! : formatNumber(value, 2),
    );
  }
  await expect(tile('Max drawdown')).toContainText(formatPercent(r.summary.max_drawdown as number));
  await expect(tile('Fills')).toContainText(formatNumber(r.trade_stats.fill_count, 0));
  await expect(tile('Closed trades')).toContainText(
    formatNumber(r.trade_stats.round_trip_count, 0),
  );
  await expect(tile('Total charges')).toContainText(formatINR(r.trade_stats.total_charges));

  // Charts: the equity curve ends at the final capital; the fills are marked on the prices.
  await page.getByRole('tab', { name: 'Charts' }).click();
  // Charts of a real run can take longer to mount than the suite's default 10 s
  // allows, and then the failure reads "element(s) not found" rather than "slow
  // chart". The values are what matter here, not how fast they appear.
  const DRAWN = { timeout: 30_000 };
  const equity = page.getByRole('img', { name: /^Equity curve/ });
  await expect(equity).toHaveAttribute('data-last-value', String(last), DRAWN);
  await expect(equity).toHaveAttribute('data-total-points', String(r.equity_curve.length), DRAWN);
  await expect(equity.locator('canvas').first()).toBeVisible(DRAWN);
  const price = page.getByRole('img', { name: /daily close price chart/ });
  await expect(price).toHaveAttribute('data-marker-count', String(r.records.fills.length), DRAWN);

  // Trades: the log and its CSV hold every trade.
  await page.getByRole('tab', { name: 'Trades' }).click();
  const log = page.getByRole('table', { name: 'Trade log' });
  await expect(log.getByRole('row')).toHaveCount(Math.min(r.round_trips.length, 20) + 1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Export CSV/ }).click(),
  ]);
  const lines = readFileSync(await download.path(), 'utf8')
    .trim()
    .split('\r\n');
  expect(lines).toHaveLength(r.round_trips.length + 1);
  expect(lines[1]).toContain(r.round_trips[0]!.entry_timestamp);

  // Records and configuration, with provenance.
  await page.getByRole('tab', { name: 'Records' }).click();
  await expect(page.getByRole('table', { name: 'Simulated fills' }).getByRole('row')).toHaveCount(
    Math.min(r.records.fills.length, 20) + 1,
  );
  await page.getByRole('tab', { name: 'Configuration' }).click();
  const config = page.getByRole('region', { name: 'Configuration' });
  await expect(config).toContainText(`Engine version${r.configuration.engine_version}`);
  await expect(config).toContainText(
    `Strategy versionv${r.configuration.strategy_version} at the run`,
  );
  await expect(config).toContainText(instrument!.symbol);
  const provenance = page.getByRole('region', { name: 'Data provenance' });
  await expect(provenance).toContainText(r.provenance.datasets[0]!.data_fingerprint!);
  await expect(provenance).toContainText(
    `Rows${formatNumber(r.provenance.datasets[0]!.row_count, 0)}`,
  );

  // The address keeps the tab across a reload.
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: 'Configuration' })).toBeVisible(BACKEND_WAIT);
});

test('a no-code strategy backtests its rules from the form (long only)', async ({ page }) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active instrument with ${MIN_BARS}+ stored daily bars.`);
  const line = (name: string) => ({ type: 'indicator', name, output: 'value' });
  const created = await page.request.post(`${BACKEND}/strategies`, {
    headers,
    data: {
      name: 'Gate: SMA cross rules',
      strategy_type: 'NO_CODE',
      strategy_config: {
        parameters: {},
        indicators: [
          { name: 'fast', type: 'SMA', parameters: { window: 5 } },
          { name: 'slow', type: 'SMA', parameters: { window: 20 } },
        ],
        entry_conditions: [{ left: line('fast'), operator: '>', right: line('slow') }],
        exit_conditions: [{ left: line('fast'), operator: '<', right: line('slow') }],
      },
    },
  });
  expect(created.status()).toBe(201);
  const strategyId = ((await created.json()) as { id: string }).id;

  // The strategy page offers the backtest; the form shows the rules, not parameters.
  await page.goto(`/app/strategies/${strategyId}`);
  await page.getByRole('link', { name: 'Backtest', exact: true }).click();
  const rules = page.getByRole('region', { name: 'Rules' });
  await expect(rules).toContainText('Buy when fast > slow.', BACKEND_WAIT);
  await expect(rules).toContainText('Sell back to flat when fast < slow.');
  await fillAndReview(page, strategyId, instrument!);
  await expect(page.getByRole('region', { name: 'Review' })).toContainText('No-code rules');
  await page.getByRole('button', { name: /Submit backtest/ }).click();
  await expect(page).toHaveURL(/\/app\/backtests\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const id = page.url().split('/').pop()!;
  await expect(page.getByText(/^Status: /)).toHaveText(
    'Status: Completed. This is final.',
    RUN_WAIT,
  );
  await expect(page.getByRole('region', { name: 'Configuration' })).toContainText(
    'Buy when fast > slow.',
  );

  // Long only: the position is never short.
  const execution = (await (
    await page.request.get(`${BACKEND}/executions/${id}`, { headers })
  ).json()) as {
    run_settings: { strategy_key: string; engine_version: string };
    execution_config: object;
    execution_metrics: { canonical_result: { trades: { side: string; quantity: number }[] } };
  };
  expect(execution.run_settings.strategy_key).toBe('no_code_rules');
  expect(execution.run_settings.engine_version).toBe('1.3');
  expect(execution.execution_config).toEqual({});
  const trades = execution.execution_metrics.canonical_result.trades;
  expect(trades.length).toBeGreaterThan(0);
  let held = 0;
  for (const trade of trades) {
    held += trade.side === 'BUY' ? trade.quantity : -trade.quantity;
    expect(held).toBeGreaterThanOrEqual(0);
  }

  // The results say which rules ran.
  await page.getByRole('link', { name: /View results/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Backtest results' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Fills', exact: true })).toContainText(
    String(trades.length),
    BACKEND_WAIT,
  );
  await page.getByRole('tab', { name: 'Configuration' }).click();
  const config = page.getByRole('region', { name: 'Configuration' });
  await expect(config).toContainText('No-code rules');
  await expect(config).toContainText('Rules (at the run)');
  await expect(config).toContainText('Buy when fast > slow.');
});

interface Report {
  id: string;
  status: string;
  verdict: { status: string; reason: string };
  source_execution_id: string | null;
  configuration: Record<string, unknown> & {
    parameters: object;
    requested_start: string | null;
    requested_end: string | null;
    quantity: number;
    slippage_bps: number;
    brokerage_rate: number;
    walk_forward: object;
    regimes: object;
    monte_carlo: { simulations: number; seed: number };
  };
  stages: Record<
    string,
    {
      name: string;
      status: string;
      checks: { label: string; passed: boolean }[];
      bootstrap?: unknown;
      significance?: { p_value: number };
    }
  >;
}

const STAGE_TABS: [string, string][] = [
  ['backtest', 'Backtest'],
  ['walk_forward', 'Walk-forward'],
  ['regime_stress', 'Regime stress'],
  ['monte_carlo', 'Monte Carlo'],
];

test('a validation from a backtest shows every stage with its evidence, reproducibly', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, `Needs an active instrument with ${MIN_BARS}+ stored daily bars.`);
  const strategyId = await momentumStrategy(page.request, headers);
  const backtest = await submitDirect(page.request, headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: 100000,
    start_timestamp: `${instrument!.first}T00:00:00+05:30`,
    end_timestamp: `${instrument!.last}T23:59:59+05:30`,
    execution_config: { lookback: 10 },
    quantity: 1,
  });
  await expect
    .poll(async () => (await getExecution(page.request, headers, backtest.id)).status, RUN_WAIT)
    .toBe('COMPLETED');

  // From the results, "Validate this strategy" opens the launcher filled in from the run.
  await page.goto(`/app/executions/${backtest.id}/results`);
  await page.getByRole('link', { name: /Validate this strategy/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New validation' })).toBeVisible(
    BACKEND_WAIT,
  );
  await expect(page.getByRole('combobox', { name: 'Strategy' })).toHaveValue(
    strategyId,
    BACKEND_WAIT,
  );
  await expect(page.getByText(/daily bars?, /).first()).toBeVisible(BACKEND_WAIT);
  // Spans that fit the stored data with room for at least five windows.
  const span = Math.max(5, Math.floor(instrument!.bars / 10));
  const fill = (name: string, value: number | string) =>
    page.getByRole('textbox', { name }).fill(String(value));
  await fill('Train span (bars)', 2 * span);
  await fill('Validation span (bars)', span);
  await fill('Test span (bars)', span);
  await fill('lookback candidates', '5, 10');
  await fill('Trend average (days)', Math.min(200, Math.max(20, Math.floor(instrument!.bars / 3))));
  await fill('Volatility window (days)', 10);
  await fill('Simulations', 300);
  await fill('Seed', 7);
  await page.getByRole('button', { name: /Review validation/ }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toContainText('seed 7');
  await page.getByRole('button', { name: /Submit validation/ }).click();
  await expect(page).toHaveURL(/\/app\/validation\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const id = page.url().split('/').pop()!;
  await expect(page.getByText(/^Status: /)).toHaveText(
    'Status: Completed. This is final.',
    RUN_WAIT,
  );

  // What the page shows = what GET /validations/{id} returns.
  const report = (await (
    await page.request.get(`${BACKEND}/validations/${id}`, { headers })
  ).json()) as Report;
  expect(report.source_execution_id).toBe(backtest.id);
  const pipeline = page.getByRole('navigation', { name: 'Validation pipeline' });
  for (const [index, [key]] of STAGE_TABS.entries()) {
    const status = report.stages[key]!.status;
    expect(['PASS', 'FAIL']).toContain(status);
    await expect(pipeline.getByRole('button').nth(index)).toContainText(
      status === 'PASS' ? 'Pass' : 'Fail',
    );
  }
  await expect(pipeline.getByRole('button').nth(4)).toContainText('Not run');
  await expect(page.getByRole('group', { name: 'Overall verdict' })).toContainText(
    report.verdict.reason,
  );
  for (const [key, name] of STAGE_TABS) {
    const stage = report.stages[key]!;
    await page.getByRole('tab', { name }).click();
    const rows = page
      .getByRole('tabpanel', { name })
      .getByRole('table', { name: `${stage.name} checks` })
      .getByRole('row');
    await expect(rows).toHaveCount(stage.checks.length + 1);
    for (const [i, check] of stage.checks.entries()) {
      await expect(rows.nth(i + 1)).toContainText(check.label);
      await expect(rows.nth(i + 1)).toContainText(check.passed ? 'Pass' : 'Fail');
    }
  }
  await expect(page.getByRole('tabpanel', { name: 'Monte Carlo' })).toContainText('simulations of');
  // Stage 5 can be started only once stages 1 to 4 have passed (nothing is started here).
  await page.getByRole('tab', { name: 'Paper trading' }).click();
  const paper = page.getByRole('tabpanel', { name: 'Paper trading' });
  if (STAGE_TABS.every(([key]) => report.stages[key]!.status === 'PASS'))
    await expect(paper.getByRole('button', { name: 'Start paper trading' })).toBeEnabled();
  else await expect(paper).toContainText('It can start once stages 1 to 4 have passed.');
  await page.getByRole('tab', { name: 'Configuration' }).click();
  await expect(page.getByRole('region', { name: 'Reproducibility' })).toContainText(
    'Monte Carlo seed7',
  );

  // The same settings and seed give the same Monte Carlo results.
  const c = report.configuration;
  const again = await submitDirect(
    page.request,
    headers,
    {
      strategy_id: strategyId,
      instrument_id: instrument!.id,
      timeframe: '1D',
      initial_capital: 100000,
      start_timestamp: c.requested_start,
      end_timestamp: c.requested_end,
      execution_config: c.parameters,
      quantity: c.quantity,
      slippage_bps: c.slippage_bps,
      brokerage_rate: c.brokerage_rate,
      walk_forward: c.walk_forward,
      regimes: c.regimes,
      monte_carlo: c.monte_carlo,
    },
    '/validations',
  );
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get(`${BACKEND}/validations/${again.id}`, { headers })
          ).json()) as Report
        ).status,
      RUN_WAIT,
    )
    .toBe('COMPLETED');
  const second = (await (
    await page.request.get(`${BACKEND}/validations/${again.id}`, { headers })
  ).json()) as Report;
  expect(second.stages.monte_carlo!.bootstrap).toEqual(report.stages.monte_carlo!.bootstrap);
  expect(second.stages.monte_carlo!.significance).toEqual(report.stages.monte_carlo!.significance);

  // Validations are listed on their own page, not in the backtest history.
  await page.goto('/app/validation');
  await expect(page.getByRole('table', { name: 'Validations' }).getByRole('row')).toHaveCount(
    3,
    BACKEND_WAIT,
  );
  const listed = (await (
    await page.request.get(`${BACKEND}/executions`, {
      headers,
      params: { execution_type: 'BACKTEST' },
    })
  ).json()) as Execution[];
  expect(listed.map((e) => e.id)).toEqual([backtest.id]);
});

interface RegimeModel {
  id: string;
  number: number;
  status: string;
  is_active: boolean;
  instrument: { id: string | null };
  card: { evaluation: { validation_bic: number } } | null;
}

test('a regime model trained from the website shows exactly what the backend classifies', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  // 100 days with complete features after the 20-day warm-up, and some room.
  const instrument = await instrumentWithData(page.request, headers, 140);
  test.skip(!instrument, 'Needs an active instrument with 140+ stored daily bars.');
  const models = async () =>
    (await (
      await page.request.get(`${BACKEND}/regime/models`, { headers })
    ).json()) as RegimeModel[];
  const before = (await models())[0]?.number ?? 0;

  await page.goto('/app/regime?tab=training');
  const form = page.getByRole('region', { name: 'Train a new model' });
  await form.getByRole('combobox', { name: 'Model type' }).selectOption('GMM');
  await form
    .getByRole('combobox', { name: 'Reference instrument' })
    .selectOption(instrument!.id, BACKEND_WAIT);
  await expect(form.getByText(/daily bars in the range/)).toBeVisible(BACKEND_WAIT);
  await form.getByRole('textbox', { name: 'Seed' }).fill('7');
  await form.getByRole('button', { name: 'Review training' }).click();
  await page.getByRole('button', { name: /Start training/ }).click();
  await expect
    .poll(async () => {
      const newest = (await models())[0];
      return newest && newest.number > before ? newest.status : 'not created';
    }, RUN_WAIT)
    .toBe('READY');
  const trained = (await models())[0]!;
  expect(trained.is_active).toBe(true);
  expect(trained.instrument.id).toBe(instrument!.id);

  // The page shows the backend's current regime and history, band by band.
  const current = (await (
    await page.request.get(`${BACKEND}/regime/current`, { headers })
  ).json()) as { regime: { name: string; code: string }; confidence: number };
  const history = (await (
    await page.request.get(`${BACKEND}/regime/history`, { headers })
  ).json()) as { periods: { start: string; end: string; code: string | null }[] };
  await page.goto('/app/regime');
  const card = page.getByRole('region', { name: 'Current regime' });
  await expect(card.getByTestId('regime-name')).toHaveText(current.regime.name, BACKEND_WAIT);
  await expect(card).toContainText(formatPercent(current.confidence));
  const bands = page.getByRole('img', { name: /regime periods labelled/ }).locator('[data-band]');
  await expect(bands).toHaveCount(history.periods.length, BACKEND_WAIT);
  for (const i of [0, history.periods.length - 1]) {
    await expect(bands.nth(i)).toHaveAttribute('data-start', history.periods[i]!.start);
    await expect(bands.nth(i)).toHaveAttribute('data-end', history.periods[i]!.end);
  }

  // The model card reports the stored evaluation.
  const detail = (await (
    await page.request.get(`${BACKEND}/regime/models/${trained.id}`, { headers })
  ).json()) as RegimeModel;
  await page.getByRole('tab', { name: 'Model card' }).click();
  await expect(page.getByRole('region', { name: 'Reported performance' })).toContainText(
    formatNumber(detail.card!.evaluation.validation_bic, 1),
    BACKEND_WAIT,
  );

  // And the dashboard widget shows the same regime.
  await page.goto('/app/dashboard');
  await expect(page.getByRole('region', { name: 'Market regime' })).toContainText(
    current.regime.name,
    BACKEND_WAIT,
  );
});

interface Supervised {
  id: string;
  number: number;
  status: string;
  error_message: string | null;
  card: {
    supervised: {
      evaluation: {
        dimensions: {
          key: string;
          name: string;
          test: { accuracy: number; balanced_accuracy: number; meets_target: boolean };
        }[];
      };
    };
  } | null;
}

test('Feature 2 gate: a supervised model trained from the website shows the API accuracy, reproducibly', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  // 252 warm-up days, the 20-day horizon and 500 labelled days.
  const instrument = await instrumentWithData(page.request, headers, 800);
  test.skip(!instrument, 'Needs an active instrument with 800+ stored daily bars.');
  const models = async () =>
    (await (
      await page.request.get(`${BACKEND}/regime/models`, { headers })
    ).json()) as Supervised[];
  const before = (await models())[0]?.number ?? 0;

  await page.goto('/app/regime?tab=training');
  const form = page.getByRole('region', { name: 'Train a new model' });
  await expect(form.getByRole('combobox', { name: 'Model type' })).toHaveValue('AUTO');
  await form
    .getByRole('combobox', { name: 'Reference instrument' })
    .selectOption(instrument!.id, BACKEND_WAIT);
  await expect(form.getByText(/labelled days after the 252-day warm-up/)).toBeVisible(BACKEND_WAIT);
  await form.getByRole('textbox', { name: 'Seed' }).fill('11');
  await form.getByRole('button', { name: 'Review training' }).click();
  await page.getByRole('button', { name: /Start training/ }).click();
  await expect
    .poll(async () => {
      const newest = (await models())[0];
      return newest && newest.number > before ? newest.status : 'not created';
    }, RUN_WAIT)
    .toBe('READY');
  const trained = (await (
    await page.request.get(`${BACKEND}/regime/models/${(await models())[0]!.id}`, { headers })
  ).json()) as Supervised;
  const dims = trained.card!.supervised.evaluation.dimensions;

  // The model card shows exactly the API's test accuracy and the target verdict.
  await page.goto(`/app/regime?tab=model&model=${trained.id}`);
  const accuracy = page.getByRole('region', { name: 'Out-of-sample accuracy' });
  for (const d of dims) {
    const tile = accuracy.getByRole('group', { name: `${d.name} accuracy` });
    await expect(tile).toContainText(formatPercent(d.test.accuracy), BACKEND_WAIT);
    await expect(tile).toContainText(d.test.meets_target ? 'Meets target' : 'Below target');
    await expect(tile).toContainText(formatPercent(d.test.balanced_accuracy));
  }

  // The current regime: one row per dimension, as the API returns it.
  const current = (await (
    await page.request.get(`${BACKEND}/regime/current`, { headers })
  ).json()) as { dimensions: { name: string; label: string }[] };
  await page.goto('/app/regime');
  const card = page.getByRole('region', { name: 'Current regime' });
  for (const d of current.dimensions)
    await expect(card.getByRole('listitem', { name: d.name })).toContainText(d.label, BACKEND_WAIT);

  // The same data and seed give the same accuracy.
  const again = await page.request.post(`${BACKEND}/regime/models`, {
    headers,
    data: { instrument_id: instrument!.id, model_kind: 'AUTO', random_state: 11 },
  });
  expect(again.status()).toBe(202);
  const againId = ((await again.json()) as { id: string }).id;
  await expect
    .poll(async () => {
      const m = (await (
        await page.request.get(`${BACKEND}/regime/models/${againId}`, { headers })
      ).json()) as Supervised;
      return m.status;
    }, RUN_WAIT)
    .toBe('READY');
  const repeat = (await (
    await page.request.get(`${BACKEND}/regime/models/${againId}`, { headers })
  ).json()) as Supervised;
  expect(repeat.card!.supervised.evaluation).toEqual(trained.card!.supervised.evaluation);
});

interface ModelStage {
  method: {
    source: string;
    model: { id: string; name: string; version: string; kind_name: string };
  };
  regimes: { name: string; days: number; max_drawdown: number | null }[];
  dimensions: { name: string; rows: { name: string; days: number }[] }[] | null;
}

test('Feature 3 gate: a validation with the market regime model shows the API per-regime figures and records the model', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers, 300);
  test.skip(!instrument, 'Needs an active instrument with 300+ stored daily bars.');
  // The active regime model; a Gaussian mixture is trained on this instrument if there is none.
  const activeModel = async () =>
    (
      (await (
        await page.request.get(`${BACKEND}/regime/models`, { headers })
      ).json()) as RegimeModel[]
    ).find((m) => m.is_active);
  if (!(await activeModel())) {
    const started = await page.request.post(`${BACKEND}/regime/models`, {
      headers,
      data: { instrument_id: instrument!.id, model_kind: 'GMM', random_state: 7 },
    });
    expect(started.status()).toBe(202);
    await expect.poll(async () => (await activeModel())?.status ?? 'none', RUN_WAIT).toBe('READY');
  }
  const active = (await activeModel())!;
  const created = await page.request.post(`${BACKEND}/strategies`, {
    headers,
    data: {
      name: 'Gate: model regimes',
      strategy_type: 'PYTHON',
      strategy_config: {
        parameters: { template: 'momentum', lookback: 10 },
        indicators: [],
        entry_conditions: [],
        exit_conditions: [],
      },
    },
  });
  expect(created.status()).toBe(201);
  const strategyId = ((await created.json()) as { id: string }).id;

  await page.goto(`/app/validation/new?strategy=${strategyId}`);
  await page
    .getByRole('combobox', { name: 'Instrument' })
    .selectOption(instrument!.id, BACKEND_WAIT);
  await page.getByLabel('From', { exact: true }).fill(instrument!.first);
  await page.getByLabel('To', { exact: true }).fill(instrument!.last);
  await expect(page.getByText(/daily bars?, /).first()).toBeVisible(BACKEND_WAIT);
  const span = Math.max(5, Math.floor(instrument!.bars / 10));
  await page.getByRole('textbox', { name: 'Train span (bars)' }).fill(String(2 * span));
  await page.getByRole('textbox', { name: 'Validation span (bars)' }).fill(String(span));
  await page.getByRole('textbox', { name: 'Test span (bars)' }).fill(String(span));
  const regimes = page.getByRole('region', { name: 'Regime stress' });
  await regimes.getByRole('combobox', { name: 'Regime source' }).selectOption('model');
  await expect(regimes.getByRole('combobox', { name: 'Regime model' })).toHaveValue(
    active.id,
    BACKEND_WAIT,
  );
  await page.getByRole('button', { name: /Review validation/ }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toContainText('Market regime model');
  await page.getByRole('button', { name: /Submit validation/ }).click();
  await expect(page).toHaveURL(/\/app\/validation\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const id = page.url().split('/').pop()!;
  await expect(page.getByText(/^Status: /)).toHaveText(
    'Status: Completed. This is final.',
    RUN_WAIT,
  );

  const report = (await (
    await page.request.get(`${BACKEND}/validations/${id}`, { headers })
  ).json()) as {
    stages: { regime_stress: ModelStage };
    configuration: { regimes: { source: string; model_id: string } };
  };
  const stage = report.stages.regime_stress;
  expect(stage.method.source).toBe('model');
  expect(stage.method.model.id).toBe(active.id);
  expect(report.configuration.regimes.model_id).toBe(active.id);

  await page.getByRole('tab', { name: 'Regime stress' }).click();
  const panel = page.getByRole('tabpanel', { name: 'Regime stress' });
  const rows = panel.getByRole('table', { name: 'Performance by regime' }).getByRole('row');
  await expect(rows).toHaveCount(stage.regimes.length + 1);
  for (const [i, regime] of stage.regimes.entries()) {
    await expect(rows.nth(i + 1)).toContainText(regime.name);
    await expect(rows.nth(i + 1)).toContainText(formatNumber(regime.days, 0));
    if (regime.max_drawdown !== null)
      await expect(rows.nth(i + 1)).toContainText(formatPercent(regime.max_drawdown));
  }
  for (const d of stage.dimensions ?? []) {
    const table = panel.getByRole('table', { name: `Performance by ${d.name.toLowerCase()}` });
    for (const [i, row] of d.rows.entries())
      await expect(table.getByRole('row').nth(i + 1)).toContainText(
        `${row.name}${formatNumber(row.days, 0)}`,
      );
  }
  await page.getByRole('tab', { name: 'Configuration' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Configuration' })).toContainText(
    `Market regime model: ${stage.method.model.name} (${stage.method.model.version}), ${stage.method.model.kind_name}`,
  );
});

interface Scored {
  strategy_id: string;
  name: string;
  status: string;
  rank: number | null;
  composite_score: number | null;
  source_execution_id: string | null;
  factors: { factor: string; contribution: number }[];
}

test('scores of strategies backtested on real data are ranked, broken down and compared as returned', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, 'Needs an active instrument with stored daily bars.');
  const strategies: string[] = [];
  for (const [name, parameters] of [
    ['Gate: scored momentum', { template: 'momentum', lookback: 10 }],
    ['Gate: scored mean reversion', { template: 'mean_reversion' }],
  ] as const) {
    const created = await page.request.post(`${BACKEND}/strategies`, {
      headers,
      data: {
        name,
        strategy_type: 'PYTHON',
        strategy_config: { parameters, indicators: [], entry_conditions: [], exit_conditions: [] },
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    strategies.push(id);
    const run = await submitDirect(page.request, headers, {
      strategy_id: id,
      instrument_id: instrument!.id,
      timeframe: '1D',
      initial_capital: 100000,
      start_timestamp: `${instrument!.first}T00:00:00+05:30`,
      end_timestamp: `${instrument!.last}T23:59:59+05:30`,
    });
    await expect
      .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
      .toBe('COMPLETED');
  }

  const scores = (await (
    await page.request.post(`${BACKEND}/scoring`, { headers, data: {} })
  ).json()) as { rows: Scored[] };
  const scored = scores.rows.filter((r) => r.status === 'SCORED');
  expect(scored.map((r) => r.strategy_id).sort()).toEqual([...strategies].sort());

  // Ranking: the API's order and composite scores.
  await page.goto('/app/scoring');
  const rows = page.getByRole('table', { name: 'Strategy ranking' }).getByRole('row');
  await expect(rows).toHaveCount(scored.length + 1, BACKEND_WAIT);
  for (const [i, s] of scored.entries()) {
    await expect(rows.nth(i + 1)).toContainText(s.name);
    await expect(rows.nth(i + 1)).toContainText(scoreText(s.composite_score));
  }

  // Breakdown: each factor's contribution, adding up to the composite.
  for (const s of scored) {
    await page.getByRole('button', { name: `Breakdown of ${s.name}` }).click();
    const breakdown = page.getByRole('region', { name: `Breakdown: ${s.name}` });
    const segments = breakdown.locator('[data-factor]');
    await expect(segments).toHaveCount(s.factors.length);
    for (const [i, f] of s.factors.entries())
      await expect(segments.nth(i)).toHaveAttribute('data-contribution', String(f.contribution));
  }

  // Comparison: both side by side, with each one's latest backtest results.
  for (const s of scored) {
    const box = page.getByRole('checkbox', { name: `Compare ${s.name}` });
    await box.click();
    await expect(box).toBeChecked();
  }
  await page.getByRole('tab', { name: 'Compare' }).click();
  const table = page.getByRole('table', { name: 'Strategy comparison' });
  await expect(table.getByRole('row', { name: /^Composite score/ })).toContainText(
    scored.map((s) => scoreText(s.composite_score)).join(''),
  );
  const sharpe: string[] = [];
  for (const s of scored) {
    const results = (await (
      await page.request.get(`${BACKEND}/executions/${s.source_execution_id}/results`, { headers })
    ).json()) as { summary: { sharpe_ratio: number | null } };
    sharpe.push(
      results.summary.sharpe_ratio === null
        ? '\u2014'
        : formatNumber(results.summary.sharpe_ratio, 2),
    );
  }
  await expect(table.getByRole('row', { name: /^Backtest: Sharpe ratio/ })).toContainText(
    sharpe.join(''),
    BACKEND_WAIT,
  );
});

interface Account {
  cash: string;
  holdings: { asset: string; quantity: number; average_price: string }[];
}

test('a portfolio is created, allocated, rebalanced and saved through the real API', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, 'Needs an active instrument with stored daily bars.');
  for (const [name, parameters] of [
    ['Gate: portfolio momentum', { template: 'momentum', lookback: 10 }],
    ['Gate: portfolio mean reversion', { template: 'mean_reversion' }],
  ] as const) {
    const created = await page.request.post(`${BACKEND}/strategies`, {
      headers,
      data: {
        name,
        strategy_type: 'PYTHON',
        strategy_config: { parameters, indicators: [], entry_conditions: [], exit_conditions: [] },
      },
    });
    expect(created.status()).toBe(201);
    const run = await submitDirect(page.request, headers, {
      strategy_id: ((await created.json()) as { id: string }).id,
      instrument_id: instrument!.id,
      timeframe: '1D',
      initial_capital: 100000,
      start_timestamp: `${instrument!.first}T00:00:00+05:30`,
      end_timestamp: `${instrument!.last}T23:59:59+05:30`,
    });
    await expect
      .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
      .toBe('COMPLETED');
  }

  // Create from the list page.
  await page.goto('/app/portfolios');
  await page
    .getByRole('button', { name: /New portfolio/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /Name/ }).fill('Gate portfolio');
  await dialog.getByRole('textbox', { name: /Initial capital/ }).fill('500000');
  await dialog.getByRole('button', { name: 'Create portfolio' }).click();
  await expect(page).toHaveURL(/\/app\/portfolios\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const id = page.url().split('/').pop()!;
  await expect(page.getByRole('group', { name: 'Saved state' })).toContainText(
    formatINR(500000),
    BACKEND_WAIT,
  );

  // Target: the page shows exactly what POST /portfolio/target returns.
  await page.getByRole('tab', { name: 'Target allocation' }).click();
  const boxes = page.getByRole('checkbox', { name: /Gate: portfolio/ });
  await expect(boxes).toHaveCount(2, BACKEND_WAIT);
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  await page.getByRole('combobox', { name: 'Regime' }).selectOption('');
  // These strategies are not validated (Feature 5): the switch lets them get capital.
  await page.getByRole('switch', { name: 'Include unvalidated strategies' }).click();
  await page.getByRole('button', { name: 'Calculate target' }).click();
  const scores = (await (
    await page.request.post(`${BACKEND}/scoring`, { headers, data: {} })
  ).json()) as { rows: { strategy_id: string; status: string }[] };
  const ids = scores.rows.filter((r) => r.status === 'SCORED').map((r) => r.strategy_id);
  const limits = {
    cash_reserve: '0',
    max_strategy_weight: '1',
    max_asset_weight: '1',
    max_invested_capital: null,
  };
  const target = (await (
    await page.request.post(`${BACKEND}/portfolio/target`, {
      headers,
      data: {
        capital: '500000.00',
        strategy_ids: ids,
        regime: null,
        limits,
        require_validated: false,
      },
    })
  ).json()) as {
    positions: { name: string; amount: string; weight: string }[];
    cash_weight: string;
  };
  const rows = page.getByRole('table', { name: 'Selected strategies' }).getByRole('row');
  await expect(rows).toHaveCount(target.positions.length + 3, BACKEND_WAIT);
  for (const [i, p] of target.positions.entries()) {
    await expect(rows.nth(i + 1)).toContainText(p.name);
    await expect(rows.nth(i + 1)).toContainText(formatINR(p.amount));
    await expect(rows.nth(i + 1)).toContainText(formatPercent(p.weight));
  }

  // Rebalance plan from all cash, then apply and save.
  await page.getByRole('tab', { name: 'Rebalance plan' }).click();
  await page.getByRole('button', { name: 'Calculate rebalance plan' }).click();
  const plan = (await (
    await page.request.post(`${BACKEND}/portfolio/rebalance`, {
      headers,
      data: {
        cash: '500000.00',
        holdings: {},
        prices: {},
        strategy_ids: ids,
        regime: null,
        limits,
        minimum_trade_value: '0',
        require_validated: false,
      },
    })
  ).json()) as {
    assets: { asset: string; action: string; trade_quantity: number }[];
    ending_state: { cash: string; holdings: { asset: string; quantity: number; price: string }[] };
  };
  const table = page.getByRole('table', { name: 'Rebalance plan by asset' });
  for (const a of plan.assets) {
    const row = table.locator(`[data-asset="${a.asset}"]`);
    await expect(row).toContainText(a.action, BACKEND_WAIT);
    await expect(row).toContainText(formatNumber(a.trade_quantity, 0));
  }
  const before = (await (
    await page.request.get(`${BACKEND}/portfolio/accounts/${id}`, { headers })
  ).json()) as Account;
  expect(before.holdings).toEqual([]);
  await page.getByRole('button', { name: 'Use this result to edit and save' }).click();
  await page.getByRole('button', { name: /Save state/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Portfolio state saved.')).toBeVisible(BACKEND_WAIT);

  // After a reload the page shows the state the API saved.
  await page.reload();
  const saved = (await (
    await page.request.get(`${BACKEND}/portfolio/accounts/${id}`, { headers })
  ).json()) as Account;
  expect(saved.cash).toBe(plan.ending_state.cash);
  expect(saved.holdings.map((h) => [h.asset, h.quantity])).toEqual(
    plan.ending_state.holdings.map((h) => [h.asset, h.quantity]),
  );
  await expect(page.getByRole('group', { name: 'Saved state' })).toContainText(
    formatINR(saved.cash),
    BACKEND_WAIT,
  );
  const holdings = page.getByRole('table', { name: 'Holdings' });
  for (const h of saved.holdings) {
    await expect(holdings).toContainText(h.asset);
    await expect(holdings).toContainText(formatNumber(h.quantity, 0));
    await expect(holdings).toContainText(formatINR(h.average_price));
  }
});

interface StoredOrder {
  id: string;
  order_side: string;
  quantity: number;
  status: string;
}

test('a completed backtest stores its orders, trades and positions, linked to the run', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, 'Needs an active instrument with stored daily bars.');
  const strategyId = await momentumStrategy(page.request, headers);
  const run = await submitDirect(page.request, headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: 100000,
    start_timestamp: `${instrument!.first}T00:00:00+05:30`,
    end_timestamp: `${instrument!.last}T23:59:59+05:30`,
  });
  await expect
    .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
    .toBe('COMPLETED');
  const counts = (await (
    await page.request.get(`${BACKEND}/executions/${run.id}/records`, { headers })
  ).json()) as { stored: boolean; orders: number; trades: number; positions: number };
  expect(counts.stored).toBe(true);
  test.skip(counts.orders === 0, 'The strategy made no trades on this data.');
  const orders = (await (
    await page.request.get(`${BACKEND}/orders`, { headers, params: { execution_id: run.id } })
  ).json()) as StoredOrder[];
  expect(orders).toHaveLength(counts.orders);

  // The results page says they are stored and links to them.
  await page.goto(`/app/executions/${run.id}/results?tab=records`);
  const panel = page.getByRole('region', { name: 'Trading records' });
  await expect(panel).toContainText(
    `${counts.orders} orders, ${counts.trades} trades, ${counts.positions} positions stored.`,
    BACKEND_WAIT,
  );
  await panel.getByRole('link', { name: /View in Trading Records/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/records\\?execution=${run.id}`));

  // Orders of this run, newest first, as the API lists them.
  const rows = page.getByRole('table', { name: 'Orders' }).getByRole('row');
  await expect(rows).toHaveCount(Math.min(orders.length, 20) + 1, BACKEND_WAIT);
  await expect(rows.nth(1)).toContainText(orders[0]!.order_side);
  await expect(rows.nth(1)).toContainText(instrument!.symbol);

  // Execution -> order -> trade, and the position.
  await rows.nth(1).click();
  const chain = page.getByRole('dialog').getByRole('list', { name: 'Relationship chain' });
  await expect(chain).toContainText('Trades (1)', BACKEND_WAIT);
  await chain.getByRole('button', { name: new RegExp(`^Open ${instrument!.symbol}`) }).click();
  const position = page.getByRole('dialog');
  await expect(position).toContainText('Realised P&L', BACKEND_WAIT);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Maintenance: a completed order cannot be reopened; the backend says why.
  const advanced = page.getByRole('switch', { name: /Advanced/ });
  await advanced.click();
  await expect(advanced).toBeChecked();
  await rows.nth(1).click();
  const tools = page.getByRole('dialog').getByRole('region', { name: 'Record maintenance' });
  await tools.getByRole('button', { name: 'Mark open' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark open' }).click();
  await expect(tools.getByRole('alert')).toHaveText(
    'Invalid order transition: COMPLETED -> OPEN.',
    BACKEND_WAIT,
  );
  await page.keyboard.press('Escape');

  for (const tab of ['Trades', 'Positions']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('table', { name: tab }).getByRole('row').nth(1)).toContainText(
      instrument!.symbol,
      BACKEND_WAIT,
    );
  }
});

test('a finished backtest notifies its owner; mark read updates the bell', async ({ page }) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers);
  test.skip(!instrument, 'Needs an active instrument with stored daily bars.');
  const bell = page.getByRole('link', { name: /^Notifications, / });
  await expect(bell).toHaveAccessibleName('Notifications, none unread', BACKEND_WAIT);

  const strategyId = await momentumStrategy(page.request, headers);
  const run = await submitDirect(page.request, headers, {
    strategy_id: strategyId,
    instrument_id: instrument!.id,
    timeframe: '1D',
    initial_capital: 100000,
    start_timestamp: `${instrument!.first}T00:00:00+05:30`,
    end_timestamp: `${instrument!.last}T23:59:59+05:30`,
  });
  await expect
    .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
    .toBe('COMPLETED');
  const [notice] = (await (
    await page.request.get(`${BACKEND}/notifications`, { headers })
  ).json()) as { id: string; title: string; message: string; execution_id: string }[];
  expect(notice).toMatchObject({
    title: 'Backtest completed',
    message: 'Backtest of "Gate: momentum backtest" completed.',
    execution_id: run.id,
  });

  await page.goto('/app/notifications');
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread', BACKEND_WAIT);
  const item = page.getByRole('listitem', { name: 'Backtest completed' });
  await expect(item).toContainText(notice!.message);
  await item.getByRole('button', { name: /^Mark read/ }).click();
  await expect(bell).toHaveAccessibleName('Notifications, none unread', BACKEND_WAIT);
  expect(
    (await (
      await page.request.get(`${BACKEND}/notifications/unread-count`, { headers })
    ).json()) as {
      unread: number;
    },
  ).toEqual({ unread: 0 });
  await item.getByRole('button', { name: /^Mark unread/ }).click();
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread', BACKEND_WAIT);

  // The notification opens the run's results and is marked read.
  await item.getByRole('link', { name: /Open results/ }).click();
  await expect(page).toHaveURL(`/app/executions/${run.id}/results`);
  await expect(bell).toHaveAccessibleName('Notifications, none unread', BACKEND_WAIT);
});

/** Active instruments of these types with at least `minBars` daily bars, with their range (IST). */
async function instrumentsWithBars(
  request: APIRequestContext,
  headers: Headers,
  types: string[],
  minBars: number,
) {
  const list = (await (await request.get(`${BACKEND}/instruments`, { headers })).json()) as {
    id: string;
    symbol: string;
    is_active: boolean;
    instrument_type: string;
  }[];
  const day = (t: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(t));
  const out = [];
  for (const instrument of list.filter((i) => i.is_active && types.includes(i.instrument_type))) {
    const c = (await (
      await request.get(`${BACKEND}/instruments/${instrument.id}/market-data/coverage`, {
        headers,
        params: { timeframe: '1D' },
      })
    ).json()) as {
      row_count: number;
      first_timestamp: string | null;
      last_timestamp: string | null;
    };
    if (c.row_count >= minBars && c.first_timestamp && c.last_timestamp)
      out.push({ ...instrument, first: day(c.first_timestamp), last: day(c.last_timestamp) });
  }
  return out;
}

test('Feature 4 gate: a ten-year weekly portfolio backtest against Nifty 50 shows exactly the API results', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const indices = await instrumentsWithBars(page.request, headers, ['INDEX'], 2000);
  const index = indices.find((i) => i.symbol.toUpperCase() === 'NIFTY50') ?? indices[0];
  const stocks = await instrumentsWithBars(page.request, headers, ['EQUITY', 'ETF'], 2000);
  test.skip(
    !index || stocks.length < 2,
    'Needs the Nifty 50 index and two equities with 2000+ stored daily bars (about 8 years or more).',
  );
  const legs = stocks.slice(0, 2);
  const end = [index!.last, ...legs.map((l) => l.last)].sort()[0]!;
  const tenBefore = `${Number(end.slice(0, 4)) - 10}${end.slice(4)}`;
  const start = [tenBefore, index!.first, ...legs.map((l) => l.first)].sort().at(-1)!;

  // Two strategies, each with a completed backtest on its own instrument.
  const ids: string[] = [];
  for (const [i, [key, params]] of (
    [
      ['momentum', { lookback: 10 }],
      ['mean_reversion', {}],
    ] as const
  ).entries()) {
    const created = await page.request.post(`${BACKEND}/strategies`, {
      headers,
      data: {
        name: `Gate: ${key} sleeve`,
        strategy_type: 'PYTHON',
        strategy_config: {
          parameters: { template: key, ...params },
          indicators: [],
          entry_conditions: [],
          exit_conditions: [],
        },
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const run = await submitDirect(page.request, headers, {
      strategy_id: id,
      instrument_id: legs[i]!.id,
      timeframe: '1D',
      initial_capital: 100000,
      start_timestamp: `${legs[i]!.first}T00:00:00+05:30`,
      end_timestamp: `${legs[i]!.last}T23:59:59+05:30`,
      execution_config: params,
      quantity: 1,
      slippage_bps: 5,
      brokerage_rate: 0.0003,
    });
    await expect
      .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
      .toBe('COMPLETED');
    ids.push(id);
  }

  // The regime filter needs a ready model: a Gaussian mixture on the index if there is none.
  const models = (await (
    await page.request.get(`${BACKEND}/regime/models`, { headers })
  ).json()) as {
    id: string;
    is_active: boolean;
    status: string;
  }[];
  let filter = models.some((m) => m.is_active && m.status === 'READY');
  if (!filter) {
    const trained = await page.request.post(`${BACKEND}/regime/models`, {
      headers,
      data: { instrument_id: index!.id, model_kind: 'GMM', random_state: 7 },
    });
    filter = trained.status() === 202;
  }

  await page.goto('/app/portfolio-backtests/new');
  for (const id of ids) await page.locator(`#pb-s-${id}`).check(BACKEND_WAIT);
  await page.getByRole('combobox', { name: 'Benchmark' }).selectOption(index!.id, BACKEND_WAIT);
  await page.getByLabel('From', { exact: true }).fill(start);
  await page.getByLabel('To', { exact: true }).fill(end);
  await page.getByRole('combobox', { name: 'Rebalancing' }).selectOption('WEEKLY');
  await page.getByRole('textbox', { name: 'Cash reserve (%)' }).fill('5');
  await page.getByRole('switch', { name: 'Also compare with 60/40' }).click();
  if (filter) {
    await expect(page.getByRole('combobox', { name: 'Regime model' })).not.toHaveValue(
      '',
      BACKEND_WAIT,
    );
  } else {
    await page.getByRole('switch', { name: 'Regime filter' }).click();
  }
  await page.getByRole('button', { name: 'Review portfolio backtest' }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toContainText(index!.symbol);
  await page.getByRole('button', { name: /Submit portfolio backtest/ }).click();
  await expect(page).toHaveURL(/\/app\/portfolio-backtests\/[0-9a-f-]{36}$/, BACKEND_WAIT);
  const id = page.url().split('/').pop()!;
  await expect(page.getByText(/^Status: /)).toHaveText(
    'Status: Completed. This is final.',
    RUN_WAIT,
  );

  const response = await page.request.get(`${BACKEND}/portfolio-backtests/${id}/results`, {
    headers,
  });
  expect(response.ok()).toBe(true);
  const r = (await response.json()) as PortfolioBacktestResults;
  // About ten years of weekly rebalances.
  expect(r.days.length).toBeGreaterThan(2000);
  expect(r.rebalance_count).toBeGreaterThan(400);
  expect(r.days[0]! >= start && r.days.at(-1)! <= end).toBe(true);

  const check = async () => {
    for (const [key, label] of [
      ['sharpe_improvement', 'Sharpe ratio improvement'],
      ['drawdown_reduction', 'Maximum drawdown reduction'],
    ] as const) {
      const o = r.objectives[key];
      const box = page.getByRole('group', { name: label });
      await expect(box).toContainText(`${label}: ${o.met ? 'met' : 'not met'}`, BACKEND_WAIT);
      await expect(box).toContainText(o.value === null ? o.reason! : formatPercent(o.value));
    }
    const keys = seriesIn(r);
    const equity = page.getByRole('img', { name: 'Portfolio value against the benchmarks' });
    await expect(equity).toHaveAttribute('data-series', keys.join(','));
    await expect(equity).toHaveAttribute('data-total-points', String(r.days.length));
    await expect(equity).toHaveAttribute(
      'data-last-values',
      keys.map((k) => r.series[k]!.at(-1)).join(','),
    );
    await expect(page.getByRole('img', { name: 'Drawdowns' })).toHaveAttribute(
      'data-last-values',
      keys.map((k) => r.drawdowns[k]!.at(-1)).join(','),
    );
    await expect(page.getByRole('img', { name: 'Weights at each rebalance' })).toHaveAttribute(
      'data-rebalance-count',
      String(r.rebalance_count),
    );
    const metrics = page.getByRole('table', { name: 'Performance metrics' });
    for (const row of METRIC_ROWS)
      await expect(
        metrics
          .getByRole('row', { name: new RegExp(`^${row.label.replace(/[()]/g, '\\$&')}`) })
          .getByRole('cell'),
      ).toHaveText(keys.map((k) => formatMetric(r.metrics[k]![row.key], row.format)));
    const relative = page.getByRole('table', { name: 'Against Nifty 50' });
    for (const row of RELATIVE_ROWS)
      await expect(
        relative
          .getByRole('row', { name: new RegExp(`^${row.label.replace(/[()]/g, '\\$&')}`) })
          .getByRole('cell')
          .first(),
      ).toHaveText(formatMetric(r.relative[row.key], row.format));
    const log = page.getByRole('table', { name: 'Rebalance log' });
    const first = r.rebalances[0]!;
    await expect(log.getByRole('row').nth(1)).toContainText(formatPercent(first.cash_weight));
    await expect(page.getByText(`1-25 of ${r.rebalances.length}`)).toBeVisible();
    await expect(page.getByText(r.notes[0]!)).toBeVisible();
  };
  await check();
  // Stored: a reload shows the same result.
  await page.reload();
  await check();
});

test('Feature 5 gate: only validated strategies get capital unless the switch is on', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instrument = await instrumentWithData(page.request, headers, 300);
  test.skip(!instrument, 'Needs an active instrument with 300+ stored daily bars.');
  const ids: string[] = [];
  for (const [name, parameters] of [
    ['Gate: validated momentum', { template: 'momentum', lookback: 10 }],
    ['Gate: unvalidated mean reversion', { template: 'mean_reversion' }],
  ] as const) {
    const created = await page.request.post(`${BACKEND}/strategies`, {
      headers,
      data: {
        name,
        strategy_type: 'PYTHON',
        strategy_config: { parameters, indicators: [], entry_conditions: [], exit_conditions: [] },
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    ids.push(id);
    const run = await submitDirect(page.request, headers, {
      strategy_id: id,
      instrument_id: instrument!.id,
      timeframe: '1D',
      initial_capital: 100000,
      start_timestamp: `${instrument!.first}T00:00:00+05:30`,
      end_timestamp: `${instrument!.last}T23:59:59+05:30`,
    });
    await expect
      .poll(async () => (await getExecution(page.request, headers, run.id)).status, RUN_WAIT)
      .toBe('COMPLETED');
  }
  // The first strategy is validated by the real pipeline (its verdict is whatever the
  // data gives); the second never is.
  const span = Math.max(5, Math.floor(instrument!.bars / 10));
  const validation = await submitDirect(
    page.request,
    headers,
    {
      strategy_id: ids[0],
      instrument_id: instrument!.id,
      timeframe: '1D',
      initial_capital: 100000,
      quantity: 20,
      start_timestamp: `${instrument!.first}T00:00:00+05:30`,
      end_timestamp: `${instrument!.last}T23:59:59+05:30`,
      walk_forward: { train_bars: 2 * span, validation_bars: span, test_bars: span },
      regimes: { source: 'rule_based' },
      monte_carlo: { simulations: 200, seed: 11 },
    },
    '/validations',
  );
  await expect
    .poll(async () => (await getExecution(page.request, headers, validation.id)).status, RUN_WAIT)
    .toBe('COMPLETED');
  type Status = { status: string; eligible: boolean; reason: string; validation_id: string | null };
  const mine = (await (await page.request.get(`${BACKEND}/strategies`, { headers })).json()) as {
    id: string;
    name: string;
    validation: Status;
  }[];
  const status = (id: string) => mine.find((s) => s.id === id)!.validation;
  expect(status(ids[0]!).validation_id).toBe(validation.id);
  expect(status(ids[1]!)).toMatchObject({ status: 'NOT_VALIDATED', eligible: false });

  // The strategies page shows each status with the API reason.
  await page.goto('/app/strategies');
  const table = page.getByRole('table', { name: 'My strategies' });
  for (const s of mine)
    await expect(
      table
        .getByRole('row', { name: new RegExp(s.name) })
        .locator(`[title="${s.validation.reason}"]`),
    ).toHaveCount(1, BACKEND_WAIT);

  const created = await page.request.post(`${BACKEND}/portfolio/accounts`, {
    headers,
    data: { name: 'Gate: validated only', initial_capital: '500000' },
  });
  expect(created.status()).toBe(201);
  const pid = ((await created.json()) as { id: string }).id;
  await page.goto(`/app/portfolios/${pid}?tab=target`);
  await expect(page.getByRole('checkbox', { name: /Gate: / })).toHaveCount(2, BACKEND_WAIT);
  await page.getByRole('combobox', { name: 'Regime' }).selectOption('');
  const toggle = page.getByRole('switch', { name: 'Include unvalidated strategies' });
  await expect(toggle).not.toBeChecked();

  // Switch off (default): what the API returned, reason for reason.
  const [first] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/portfolio/target')),
    page.getByRole('button', { name: 'Calculate target' }).click(),
  ]);
  const sent = first.request().postDataJSON() as { require_validated: boolean };
  expect(sent.require_validated).toBe(true);
  if (first.status() === 422) {
    // Nothing eligible: the refusal lists each reason as returned.
    const detail = ((await first.json()) as { detail: string }).detail;
    for (const id of ids) expect(detail).toContain(status(id).reason);
    await expect(page.getByRole('alert').filter({ hasText: 'None of the chosen' })).toHaveText(
      detail,
    );
  } else {
    expect(first.status()).toBe(200);
    const target = (await first.json()) as {
      positions: { strategy_id: string; name: string }[];
      excluded: { strategy_id: string; name: string; reason: string }[];
    };
    for (const p of target.positions) expect(status(p.strategy_id).eligible).toBe(true);
    expect(target.excluded.map((e) => e.strategy_id)).toContain(ids[1]);
    const list = page.getByRole('list', { name: 'Not allocated' });
    for (const e of target.excluded) {
      if (!status(e.strategy_id).eligible) expect(e.reason).toBe(status(e.strategy_id).reason);
      await expect(list.getByRole('listitem').filter({ hasText: e.name })).toContainText(
        e.reason,
        BACKEND_WAIT,
      );
    }
    await expect(
      page.getByRole('table', { name: 'Selected strategies' }).getByRole('row'),
    ).toHaveCount(target.positions.length + 3);
  }

  // Switch on: the unvalidated strategy gets capital, and the page warns.
  await toggle.click();
  const [second] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/portfolio/target')),
    page.getByRole('button', { name: 'Calculate target' }).click(),
  ]);
  expect(
    (second.request().postDataJSON() as { require_validated: boolean }).require_validated,
  ).toBe(false);
  expect(second.status()).toBe(200);
  const open = (await second.json()) as { positions: { strategy_id: string; name: string }[] };
  expect(open.positions.map((p) => p.strategy_id)).toContain(ids[1]);
  await expect(page.getByRole('note', { name: 'Unvalidated strategies included' })).toContainText(
    'Gate: unvalidated mean reversion',
    BACKEND_WAIT,
  );
});
