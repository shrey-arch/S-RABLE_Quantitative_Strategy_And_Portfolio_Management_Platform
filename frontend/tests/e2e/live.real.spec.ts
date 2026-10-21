import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { backendIsUp } from './support/backend';
import { formatINR } from '../../src/lib/format';

/**
 * Feature 7 gate against the REAL backend and its runner: a momentum strategy is
 * replayed at 10x on a recorded day of 1-minute bars, set up through the form.
 * Bars arrive on the stream without a reload; every number on the screen equals
 * GET /live/sessions/{id} and its fills; Stop with square-off flattens the
 * position at once; the fills are simulated MIS orders in the paper account; a
 * reload shows the stored state.
 *
 * Needs an active NSE equity with a recorded day (GET /live/replay-days): on your
 * machine, run a delayed live session for a day first (the recorder stores the
 * Yahoo bars). Skipped when the backend is not on localhost:8000.
 *
 * Each run registers a new user named e2e-<time>@example.com.
 */

const BACKEND = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000';
const PASSWORD = 'E2e-test-pass-123';
const WAIT = { timeout: 30_000 };

test.beforeAll(async ({ request }) => {
  const up = await backendIsUp(request, BACKEND);
  test.skip(!up, `Backend not reachable at ${BACKEND}; start uvicorn to run these.`);
});

test.skip(({ isMobile }) => isMobile, 'Real-API journeys run on desktop only');
test.describe.configure({ timeout: 300_000 });

async function registerAndLogIn(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Live');
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

/** An NSE equity or ETF with a replayable recorded day, and that day. */
async function recorded(request: APIRequestContext, headers: Record<string, string>) {
  const all = (await (
    await request.get(`${BACKEND}/instruments`, { headers })
  ).json()) as Instrument[];
  for (const i of all.filter(
    (x) => x.is_active && x.exchange === 'NSE' && ['EQUITY', 'ETF'].includes(x.instrument_type),
  )) {
    const days = (await (
      await request.get(`${BACKEND}/live/replay-days`, { headers, params: { instrument_id: i.id } })
    ).json()) as { day: string; replayable: boolean }[];
    const day = days.find((d) => d.replayable);
    if (day) return { instrument: i, day: day.day };
  }
  return null;
}

test('Feature 7 gate: a replay runs on the real runner; the screen equals the API; Stop flattens', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const found = await recorded(page.request, headers);
  test.skip(!found, 'Needs an NSE instrument with a recorded day of 1-minute bars.');
  const { instrument, day } = found!;
  const created = await page.request.post(`${BACKEND}/strategies`, {
    headers,
    data: {
      name: 'Gate: intraday momentum',
      strategy_type: 'PYTHON',
      strategy_config: {
        parameters: { template: 'momentum', lookback: 3 },
        indicators: [],
        entry_conditions: [],
        exit_conditions: [],
      },
    },
  });
  expect(created.ok()).toBe(true);
  const strategy = (await created.json()) as { id: string };

  // Set up through the form: 1-minute bars, the recorded day, 10x.
  await page.goto('/app/live/new');
  await page.getByLabel('Strategy', { exact: true }).selectOption(strategy.id);
  await page.getByLabel('Instrument').selectOption(instrument.id);
  await page.getByLabel('Bars', { exact: true }).selectOption('1M');
  await page.getByLabel('Recorded day', { exact: true }).selectOption(day, WAIT);
  await page.getByLabel('Speed').selectOption('10');
  await page.getByLabel('Shares per position').fill('20');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page).toHaveURL(/\/app\/live\/sessions\/[0-9a-f-]{36}$/, WAIT);
  const id = page.url().split('/').at(-1)!;
  const get = async <T>(path: string) =>
    (await (
      await page.request.get(`${BACKEND}/live/sessions/${id}${path}`, { headers })
    ).json()) as T;

  // The stream brings closed bars without a reload (one every 6 s at 10x).
  await expect(page.getByTestId('stream-state')).toHaveText('Live updates on', WAIT);
  const chart = page.getByRole('img', { name: /1M bars/ });
  await expect
    .poll(async () => Number(await chart.getAttribute('data-bar-count')), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(5);
  const first = Number(await chart.getAttribute('data-bar-count'));
  await expect
    .poll(async () => Number(await chart.getAttribute('data-bar-count')), { timeout: 60_000 })
    .toBeGreaterThan(first);
  await expect(page.getByText('Virtual money \u00b7 simulated orders').first()).toBeVisible();

  // Wait for a position, then Stop with square-off.
  await expect
    .poll(async () => (await get<{ position_qty: number }>('')).position_qty !== 0, {
      timeout: 120_000,
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Stop and square off now' }).click();
  await expect(page.getByTestId('status-reason')).toHaveText(
    'Stopped by you; the position was squared off.',
    WAIT,
  );
  type Session = {
    status: string;
    position_qty: number;
    money: { equity: number; realised_pnl: number; charges: number; net_pnl: number };
    summary: { net_pnl: number; closed_trades: number; charges: number } | null;
  };
  await expect.poll(async () => (await get<Session>('')).status, WAIT).toBe('STOPPED');
  const s = await get<Session>('');
  expect(s.position_qty).toBe(0);
  const fills = await get<{ reason: string; total_charges: number }[]>('/fills');
  expect(fills.at(-1)!.reason).toBe('Stopped by you (square off now)');

  // Every number on the screen is the API's; also after a reload.
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    const summary = page.getByRole('region', { name: 'Session summary' });
    await expect(summary).toContainText(formatINR(s.summary!.net_pnl), WAIT);
    await expect(summary).toContainText(formatINR(s.summary!.charges));
    const tiles = page.getByRole('region', { name: 'Position and P&L' });
    await expect(tiles).toContainText(`PositionFlat`);
    await expect(tiles).toContainText(formatINR(s.money.equity));
    await expect(tiles).toContainText(formatINR(s.money.realised_pnl));
    await expect(page.getByRole('table', { name: 'Session fills' }).getByRole('row')).toHaveCount(
      fills.length + 1,
    );
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  }

  // Only simulated orders: intraday fills in the paper account.
  await page.getByRole('link', { name: 'All fills in the paper account' }).click();
  await expect(page).toHaveURL(/tab=account&view=fills/);
  const paperFills = (await (
    await page.request.get(`${BACKEND}/paper/fills`, { headers })
  ).json()) as unknown[];
  expect(paperFills).toHaveLength(fills.length);
  await expect(page.getByRole('table', { name: 'Fills' }).getByRole('row')).toHaveCount(
    Math.min(fills.length, 20) + 1,
    WAIT,
  );
  const sessions = (await (
    await page.request.get(`${BACKEND}/live/sessions`, { headers })
  ).json()) as unknown[];
  expect(sessions).toHaveLength(1);
});
