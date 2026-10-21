import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import { coverage } from '../../src/features/instruments/market-data-fixture';
import { REGISTRY_FIXTURE } from '../../src/features/strategies/registry-fixture';

/**
 * Phase 9: configure, submit and follow a backtest in a real browser. An
 * in-memory fake of the backtest API answers fetch requests: a submitted run
 * moves PENDING -> RUNNING -> COMPLETED over a few status reads, like the
 * real worker, and keeps its state across reloads.
 */

const USER = { id: 'u-1', full_name: 'BT Test', email: 'b@example.com', account_status: 'ACTIVE' };
const RELIANCE = INSTRUMENTS_FIXTURE[0]!;

const STRATEGY = {
  id: 's1',
  user_id: USER.id,
  name: 'Nifty momentum',
  description: null,
  strategy_type: 'PYTHON',
  strategy_config: {
    parameters: { template: 'momentum', lookback: 20 },
    indicators: [],
    entry_conditions: [],
    exit_conditions: [],
  },
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
};

type Run = Record<string, unknown> & { id: string; status: string };
type FakeRun = Run & { reads: number; stuck?: boolean };

interface Fake {
  runs: Map<string, FakeRun>;
  posts: number;
  reads: (id: string) => number;
}

const baseRun = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  strategy_id: STRATEGY.id,
  broker_account_id: null,
  instrument_id: RELIANCE.id,
  execution_type: 'BACKTEST',
  status: 'PENDING',
  timeframe: '1D',
  initial_capital: 100000,
  execution_config: { lookback: 20 },
  execution_metrics: null,
  run_settings: {
    strategy_key: 'momentum',
    start_timestamp: '2025-01-01T00:00:00+05:30',
    end_timestamp: '2025-06-30T23:59:59+05:30',
    quantity: 1,
    other_instrument_ids: [],
    slippage_bps: 0,
    brokerage_rate: 0,
  },
  error_message: null,
  error: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:00Z',
  ...over,
});

/** A run advances one step per status read, unless it is stuck or finished. */
function advance(run: FakeRun) {
  run.reads += 1;
  if (run.stuck || !['PENDING', 'RUNNING'].includes(run.status)) return;
  if (run.reads === 2)
    Object.assign(run, { status: 'RUNNING', started_at: '2026-10-16T09:00:02Z' });
  if (run.reads >= 3)
    Object.assign(run, { status: 'COMPLETED', completed_at: '2026-10-16T09:00:09Z' });
}

async function open(page: Page, path: string, seed: (Run & { stuck?: boolean })[] = []) {
  const fake: Fake = {
    runs: new Map(seed.map((r) => [r.id, { ...r, reads: 0 }])),
    posts: 0,
    reads: (id) => fake.runs.get(id)?.reads ?? 0,
  };
  let next = 1;

  // Every call the pages make is answered here, so a running backend never sees
  // the stand-in token (its 401 would log the test out).
  await page.route(
    (url) =>
      ['/users/me', '/strategies', '/strategy-registry', '/instruments', '/backtests'].some(
        (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
      ) || url.pathname.startsWith('/executions'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      if (path === '/strategy-registry') return route.fulfill({ json: REGISTRY_FIXTURE });
      if (path.endsWith('/validate')) return route.fulfill({ json: {} });
      if (path === '/strategies') return route.fulfill({ json: [STRATEGY] });
      if (path === `/strategies/${STRATEGY.id}`) return route.fulfill({ json: STRATEGY });
      if (path === '/instruments') return route.fulfill({ json: INSTRUMENTS_FIXTURE });
      if (path.endsWith('/market-data/coverage')) {
        const start = url.searchParams.get('start_date');
        const end = url.searchParams.get('end_date');
        return route.fulfill({
          json: coverage({
            row_count: start ? 120 : 250,
            first_timestamp: `${start ?? '2025-01-01'}T00:00:00Z`,
            last_timestamp: `${end ?? '2025-12-31'}T00:00:00Z`,
            trading_days: { ...coverage().trading_days, missing_days: 0, missing_periods: [] },
          }),
        });
      }
      if (path === '/backtests' && request.method() === 'POST') {
        fake.posts += 1;
        const body = request.postDataJSON() as Record<string, unknown>;
        const run = {
          ...baseRun(`run-${next++}`, {
            instrument_id: body.instrument_id,
            initial_capital: body.initial_capital,
            execution_config: body.execution_config,
            run_settings: {
              strategy_key: body.strategy_key,
              start_timestamp: body.start_timestamp,
              end_timestamp: body.end_timestamp,
              quantity: body.quantity,
              other_instrument_ids: body.other_instrument_ids,
              slippage_bps: body.slippage_bps,
              brokerage_rate: body.brokerage_rate,
            },
          }),
          reads: 0,
        };
        fake.runs.set(run.id, run);
        // Slow enough that a double-click lands while the first request is in flight.
        await new Promise((r) => setTimeout(r, 300));
        return route.fulfill({ status: 201, json: run });
      }
      if (path === '/executions') {
        const wanted = url.searchParams.get('status');
        const list = [...fake.runs.values()].filter((r) => !wanted || r.status === wanted);
        return route.fulfill({ json: list.reverse() });
      }
      const match = /^\/executions\/([^/]+)(\/cancel)?$/.exec(path);
      const run = match ? fake.runs.get(match[1]!) : undefined;
      if (!run) return route.fulfill({ status: 404, json: { detail: 'Execution not found.' } });
      if (match![2]) {
        if (!['PENDING', 'RUNNING'].includes(run.status))
          return route.fulfill({
            status: 409,
            json: { detail: `This execution has already finished (${run.status}).` },
          });
        Object.assign(run, { status: 'CANCELLED', completed_at: '2026-10-16T09:00:20Z' });
        return route.fulfill({ json: run });
      }
      advance(run);
      return route.fulfill({ json: run });
    },
  );
  await quietBell(page);
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
  await page.goto(path);
  return fake;
}

const status = (page: Page) => page.getByText(/^Status: /);

async function fillForm(page: Page) {
  await expect(page.getByRole('combobox', { name: 'Strategy' })).toHaveValue(STRATEGY.id);
  await page.getByRole('combobox', { name: 'Instrument' }).selectOption(RELIANCE.id);
  await page.getByLabel('From', { exact: true }).fill('2025-01-01');
  await page.getByLabel('To', { exact: true }).fill('2025-06-30');
  await expect(page.getByText(/120 daily bars, 01 Jan 2025 to 30 Jun 2025/)).toBeVisible();
  await page.getByRole('button', { name: /Review backtest/ }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toBeVisible();
}

test('submit -> PENDING -> RUNNING -> COMPLETED, then polling stops', async ({ page }) => {
  const fake = await open(page, '/app/backtests/new?strategy=s1');
  await fillForm(page);
  await page.getByRole('button', { name: /Submit backtest/ }).click();

  await expect(page).toHaveURL(/\/app\/backtests\/run-1$/);
  await expect(status(page)).toHaveText(/Status: (Pending|Running)\./);
  await expect(status(page)).toHaveText('Status: Completed. This is final.', { timeout: 15_000 });
  const steps = page.getByRole('list', { name: 'Timeline' }).getByRole('listitem');
  await expect(steps).toHaveText([/^Created \(done\)/, /^Started \(done\)/, /^Completed \(done\)/]);
  await expect(page.getByRole('button', { name: /Cancel backtest/ })).toHaveCount(0);

  const reads = fake.reads('run-1');
  await page.waitForTimeout(6000);
  expect(fake.reads('run-1')).toBe(reads);
});

test('a double-click on Submit creates one job', async ({ page }) => {
  const fake = await open(page, '/app/backtests/new?strategy=s1');
  await fillForm(page);
  await page.getByRole('button', { name: /Submit backtest/ }).dblclick();
  await expect(page).toHaveURL(/\/app\/backtests\/run-1$/);
  expect(fake.posts).toBe(1);
});

test('a failed run shows the error code; the address works after a reload', async ({ page }) => {
  await open(page, '/app/backtests/f1', [
    baseRun('f1', {
      status: 'FAILED',
      started_at: '2026-10-16T09:00:02Z',
      completed_at: '2026-10-16T09:00:03Z',
      error_message: 'No market data for the chosen instrument and dates.',
      error: {
        category: 'MARKET_DATA',
        code: 'BACKTEST_MARKET_DATA_UNAVAILABLE',
        message: 'No market data for the chosen instrument and dates.',
        stage: 'data_loading',
      },
    }),
  ]);
  const why = page.getByRole('region', { name: 'Why it failed' });
  await expect(why).toContainText('BACKTEST_MARKET_DATA_UNAVAILABLE');
  await page.reload();
  await expect(why).toContainText('No market data for the chosen instrument and dates.');
  await expect(status(page)).toHaveText('Status: Failed. This is final.');
});

test('cancel asks first and the run stays cancelled after a reload', async ({ page }) => {
  await open(page, '/app/backtests/r1', [
    { ...baseRun('r1', { status: 'RUNNING', started_at: '2026-10-16T09:00:02Z' }), stuck: true },
  ]);
  await expect(status(page)).toHaveText(/Status: Running\./);
  await page.getByRole('button', { name: /Cancel backtest/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel backtest' }).click();
  await expect(status(page)).toHaveText('Status: Cancelled. This is final.');
  await page.reload();
  await expect(status(page)).toHaveText('Status: Cancelled. This is final.');
  await expect(page.getByRole('list', { name: 'Timeline' })).toContainText('Cancelled (done)');
});

test('edit and rerun opens the form filled in from the run', async ({ page }) => {
  await open(page, '/app/backtests/c1', [
    baseRun('c1', {
      status: 'COMPLETED',
      started_at: '2026-10-16T09:00:02Z',
      completed_at: '2026-10-16T09:00:09Z',
      run_settings: { ...baseRun('x').run_settings, quantity: 7, slippage_bps: 12 },
    }),
  ]);
  await page.getByRole('link', { name: /Edit and rerun/ }).click();
  await expect(page).toHaveURL(/\/app\/backtests\/new\?from=c1$/);
  await expect(page.getByRole('combobox', { name: 'Instrument' })).toHaveValue(RELIANCE.id);
  await expect(page.getByRole('textbox', { name: 'Quantity per trade' })).toHaveValue('7');
  await expect(page.getByRole('textbox', { name: 'Slippage (bps)' })).toHaveValue('12');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue('2025-01-01');
});

test('form and status page fit the screen (phones included)', async ({ page }) => {
  await open(page, '/app/backtests/new?strategy=s1', [
    baseRun('w1', { status: 'RUNNING', started_at: '2026-10-16T09:00:02Z' }),
  ]);
  await expect(page.getByRole('heading', { level: 1, name: 'New backtest' })).toBeVisible();
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.goto('/app/backtests/w1');
  await expect(page.getByRole('heading', { level: 1, name: 'Backtest' })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
});

test('history lists the runs, filters by status in the address, and opens a run', async ({
  page,
  isMobile,
}) => {
  await open(page, '/app/executions', [
    baseRun('h1', {
      status: 'COMPLETED',
      started_at: '2026-10-16T09:00:02Z',
      completed_at: '2026-10-16T09:00:09Z',
    }),
    baseRun('h2', {
      status: 'FAILED',
      created_at: '2026-10-16T10:00:00Z',
      completed_at: '2026-10-16T10:00:03Z',
      error: { code: 'BACKTEST_MARKET_DATA_UNAVAILABLE', message: 'No market data.' },
    }),
  ]);
  const table = page.getByRole('table', { name: 'Backtests' });
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(page.getByText('2 backtests.')).toBeVisible();

  await page.getByRole('combobox', { name: 'Status' }).selectOption('FAILED');
  await expect(page).toHaveURL(/status=FAILED/);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('BACKTEST_MARKET_DATA_UNAVAILABLE');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveValue('FAILED');
  await expect(table.getByRole('row')).toHaveCount(2);

  await table.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/app\/backtests\/h2$/);
  await expect(page.getByText('Status: Failed. This is final.')).toBeVisible();
  await page
    .getByRole('link', { name: /Backtest history/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/executions/);

  if (!isMobile) {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Backtest history' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
});

test('the roadmap address /app/executions/:id opens the run', async ({ page }) => {
  await open(page, '/app/executions/h9', [
    baseRun('h9', { status: 'CANCELLED', completed_at: '2026-10-16T09:00:05Z' }),
  ]);
  await expect(page).toHaveURL(/\/app\/backtests\/h9$/);
  await expect(page.getByText('Status: Cancelled. This is final.')).toBeVisible();
});
