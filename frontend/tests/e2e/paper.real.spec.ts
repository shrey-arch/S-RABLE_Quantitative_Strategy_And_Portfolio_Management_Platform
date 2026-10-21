import { expect, test, type Page } from '@playwright/test';
import { backendIsUp } from './support/backend';
import { formatINR } from '../../src/lib/format';

/**
 * Feature 1 gate against the REAL backend: a new user's paper account starts
 * with Rs 10,00,000; an instrument is added to the watchlist; a limit buy far
 * below the market stays open with its cash held back exactly as the API says;
 * its journal note is saved; it is cancelled; the account is reset. A no-code
 * strategy is deployed, the due days are run, and it is paused and stopped.
 * Works whether the market is open or closed, and whether or not Yahoo Finance
 * answers.
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
test.describe.configure({ timeout: 180_000 });

async function registerAndLogIn(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Paper');
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

test('a paper account trades through the real API: limit buy held, cancelled, reset', async ({
  page,
}) => {
  const headers = await registerAndLogIn(page);
  const instruments = (await (
    await page.request.get(`${BACKEND}/instruments`, { headers })
  ).json()) as {
    id: string;
    symbol: string;
    exchange: string;
    instrument_type: string;
    is_active: boolean;
  }[];
  const pick = instruments.find(
    (i) => i.is_active && i.exchange === 'NSE' && ['EQUITY', 'ETF'].includes(i.instrument_type),
  );
  test.skip(!pick, 'Needs an active NSE equity or ETF instrument.');

  await page.goto('/app/paper');
  const summary = page.getByRole('region', { name: 'Account summary' });
  await expect(summary).toContainText(`Equity${formatINR(1000000)}`, WAIT);

  // Watchlist: the row shows a quote, or the reason there is none.
  await page.getByLabel('Add to watchlist').selectOption(pick!.id);
  const row = page
    .getByRole('list', { name: 'Watchlist instruments' })
    .getByRole('listitem', { name: pick!.symbol });
  await expect(row).toBeVisible(WAIT);

  // A limit buy at Rs 1 never fills: it stays open and holds cash back.
  await row.getByRole('button', { name: 'Buy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Order type/).selectOption('LIMIT');
  await dialog.getByLabel(/Quantity/).fill('3');
  await dialog.getByLabel(/^Price/).fill('1');
  await dialog.getByRole('button', { name: 'Place buy order' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, WAIT);
  const open = page.getByRole('table', { name: 'Open orders' });
  await expect(open.getByRole('row')).toHaveCount(2, WAIT);
  const [order] = (await (
    await page.request.get(`${BACKEND}/paper/orders`, { headers })
  ).json()) as {
    id: string;
    status: string;
    reserved_amount: number;
  }[];
  expect(order!.status).toBe('OPEN');
  const account = (await (
    await page.request.get(`${BACKEND}/paper/account`, { headers })
  ).json()) as {
    blocked_cash: number;
  };
  expect(account.blocked_cash).toBe(order!.reserved_amount);
  await page.reload();
  await expect(summary).toContainText(
    `${formatINR(order!.reserved_amount)} held for open buys`,
    WAIT,
  );

  // The journal keeps a note and tags on the order.
  await open
    .getByRole('button', { name: new RegExp(`^Journal for BUY 3 ${pick!.symbol}`) })
    .click();
  const journal = page.getByRole('dialog', { name: 'Trade journal' });
  await journal.getByLabel(/Note/).fill('Far below the market');
  await journal.getByLabel(/Tags/).fill('test, limit');
  await journal.getByRole('button', { name: 'Save journal' }).click();
  await expect(journal).toHaveCount(0, WAIT);
  await expect(open).toContainText('Far below the market', WAIT);
  const [noted] = (await (
    await page.request.get(`${BACKEND}/paper/orders`, { headers })
  ).json()) as { note: string; tags: string[] }[];
  expect(noted).toMatchObject({ note: 'Far below the market', tags: ['test', 'limit'] });

  // Cancel, then the order book shows it cancelled and no cash is held.
  await open.getByRole('button', { name: new RegExp(`^Cancel BUY 3 ${pick!.symbol}`) }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText('No orders')).toBeVisible(WAIT);
  await page.getByRole('tab', { name: 'Order book' }).click();
  await expect(page.getByRole('table', { name: 'Order book' })).toContainText('Cancelled', WAIT);
  await expect(summary).not.toContainText('held for open buys');

  // Reset with Rs 5,00,000.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Starting cash (Rs)').fill('500000');
  await page.getByRole('button', { name: 'Reset account' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset' }).click();
  await expect(summary).toContainText(`Equity${formatINR(500000)}`, WAIT);
  const reset = (await (
    await page.request.get(`${BACKEND}/paper/orders`, { headers })
  ).json()) as unknown[];
  expect(reset).toEqual([]);
});

test('a no-code strategy is deployed to the paper account and controlled', async ({ page }) => {
  const headers = await registerAndLogIn(page);
  const instruments = (await (
    await page.request.get(`${BACKEND}/instruments`, { headers })
  ).json()) as { id: string; exchange: string; instrument_type: string; is_active: boolean }[];
  const pick = instruments.find(
    (i) => i.is_active && i.exchange === 'NSE' && ['EQUITY', 'ETF'].includes(i.instrument_type),
  );
  test.skip(!pick, 'Needs an active NSE equity or ETF instrument.');
  const close = { type: 'price', field: 'close' };
  const sma = { type: 'indicator', name: 'sma5' };
  const created = await page.request.post(`${BACKEND}/strategies`, {
    headers,
    data: {
      name: 'Gate: paper SMA5',
      strategy_type: 'NO_CODE',
      strategy_config: {
        parameters: {},
        indicators: [{ name: 'sma5', type: 'SMA', parameters: { window: 5 } }],
        entry_conditions: [{ left: close, operator: '>', right: sma }],
        exit_conditions: [{ left: close, operator: '<', right: sma }],
      },
    },
  });
  expect(created.status()).toBe(201);
  const strategy = (await created.json()) as { id: string };

  await page.goto('/app/paper?tab=strategies');
  await expect(page.getByText('No deployments')).toBeVisible(WAIT);
  await page.getByRole('button', { name: /Deploy strategy/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /Strategy/ }).selectOption(strategy.id);
  await dialog.getByRole('combobox', { name: /Instrument/ }).selectOption(pick!.id);
  await dialog.getByLabel(/Quantity/).fill('2');
  await dialog.getByLabel(/Capital/).fill('50000');
  await dialog.getByLabel(/Loss limit/).fill('15');
  await dialog.getByRole('button', { name: 'Deploy' }).click();
  await expect(page).toHaveURL(/\/app\/live\/deployments\/[0-9a-f-]{36}$/, WAIT);
  const id = page.url().split('/').pop()!;
  const dep = (await (
    await page.request.get(`${BACKEND}/paper/deployments/${id}`, { headers })
  ).json()) as { name: string; status: string; capital: number; loss_limit: number };
  expect(dep).toMatchObject({ status: 'ACTIVE', capital: 50000, loss_limit: 0.15 });
  await expect(page.getByRole('heading', { level: 1, name: dep.name })).toBeVisible(WAIT);
  await expect(page.getByRole('region', { name: 'Configuration' })).toContainText(
    `Capital${formatINR(50000)}`,
  );

  // The daily job's work on demand: safe whether or not a close is due yet.
  await page.goto('/app/paper?tab=strategies');
  await page.getByRole('button', { name: 'Run due days now' }).click();
  await expect(page.getByText(/^Processed \d+ deployment days? through/)).toBeVisible(WAIT);
  await page.getByRole('link', { name: dep.name }).click();

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible(WAIT);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop deployment' }).click();
  // Wait for a control that is gone only once it is STOPPED. While it is PAUSED
  // the page offers Resume and Stop, not Pause - so waiting for "Pause" to go was
  // already true before the stop was sent, and waited for nothing. (The mocked
  // test next door had this right; this one did not.)
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0, WAIT);
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, WAIT);
  const stopped = (await (
    await page.request.get(`${BACKEND}/paper/deployments/${id}`, { headers })
  ).json()) as { status: string };
  expect(stopped.status).toBe('STOPPED');
});
