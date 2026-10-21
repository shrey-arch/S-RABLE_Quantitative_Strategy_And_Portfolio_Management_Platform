import { expect, test, type Page } from '@playwright/test';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import {
  DEPLOY_DEPLOYMENT,
  DEPLOY_DEPLOYMENTS,
  DEPLOY_PERFORMANCE,
  DEPLOY_RUN_DUE,
} from '../../src/features/paper/deploy-fixture';
import {
  PAPER_ACCOUNT,
  PAPER_CHARGES,
  PAPER_FILLS,
  PAPER_HOLDINGS,
  PAPER_NO_FUNDS,
  PAPER_ORDERS,
  PAPER_PREVIEW,
  PAPER_QUOTES,
} from '../../src/features/paper/paper-fixture';
import { LIVE_STATUS } from '../../src/features/live/live-fixture';
import { REGISTRY_FIXTURE } from '../../src/features/strategies/registry-fixture';
import { formatINR, formatPercent } from '../../src/lib/format';
import { quietBell } from './support/bell';

/**
 * Feature 1: paper trading in a real browser (since Feature 7 it is the Paper account,
 * Deployments and Performance tabs of Live Trading (Paper); the old /app/paper
 * addresses redirect there). A fake of the API answers with the
 * backend's own responses (paper-fixture.ts, deploy-fixture.ts) and keeps cancels,
 * placed orders, deployments and journal notes in memory.
 */

const USER = {
  id: 'u-1',
  full_name: 'Paper Test',
  email: 'paper@example.com',
  account_status: 'ACTIVE',
  email_verified: false,
  phone_number: null,
  profile_image_url: null,
  last_login_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const SMA3 = {
  id: DEPLOY_DEPLOYMENT.strategy_id,
  user_id: 'u-1',
  name: 'SMA3 cross',
  description: null,
  strategy_type: 'NO_CODE',
  strategy_config: DEPLOY_DEPLOYMENT.rules,
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
};

interface Fake {
  orders: typeof PAPER_ORDERS;
  deployment: typeof DEPLOY_DEPLOYMENT;
  bodies: { method: string; path: string; body: unknown }[];
}

async function open(page: Page, path: string, opts: { refuse?: boolean } = {}) {
  const fake: Fake = {
    orders: PAPER_ORDERS.map((o) => ({ ...o })),
    deployment: { ...DEPLOY_DEPLOYMENT },
    bodies: [],
  };
  await quietBell(page);
  await page.route(
    (url) =>
      ['/users/me', '/instruments', '/strategies', '/strategy-registry'].includes(url.pathname) ||
      url.pathname.startsWith('/paper/') ||
      url.pathname.startsWith('/live/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const p = new URL(request.url()).pathname;
      const method = request.method();
      const body = request.postData() ? (JSON.parse(request.postData()!) as unknown) : null;
      if (method !== 'GET' && p !== '/paper/orders/preview')
        fake.bodies.push({ method, path: p, body });
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/live/sessions') return route.fulfill({ json: [] });
      if (p === '/live/status') return route.fulfill({ json: LIVE_STATUS });
      if (p === '/instruments') return route.fulfill({ json: INSTRUMENTS_FIXTURE });
      if (p === '/strategies') return route.fulfill({ json: [SMA3] });
      if (p === '/strategy-registry') return route.fulfill({ json: REGISTRY_FIXTURE });
      if (p === '/paper/performance') return route.fulfill({ json: DEPLOY_PERFORMANCE });
      if (p === '/paper/deployments/run-due') return route.fulfill({ json: DEPLOY_RUN_DUE });
      if (p === '/paper/deployments' && method === 'GET')
        return route.fulfill({ json: DEPLOY_DEPLOYMENTS });
      if (p === '/paper/deployments') return route.fulfill({ status: 201, json: fake.deployment });
      if (p === `/paper/deployments/${fake.deployment.id}`)
        return route.fulfill({ json: fake.deployment });
      if (p.startsWith(`/paper/deployments/${fake.deployment.id}/`)) {
        const action = p.split('/').at(-1);
        fake.deployment = {
          ...fake.deployment,
          status: action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'STOPPED',
          status_reason: action === 'stop' ? 'Stopped by you.' : null,
        };
        return route.fulfill({ json: fake.deployment });
      }
      if (p.endsWith('/journal')) {
        const id = p.split('/')[3];
        const b = body as { note: string | null; tags: string[] };
        fake.orders = fake.orders.map((o) => (o.id === id ? { ...o, ...b } : o));
        return route.fulfill({ json: fake.orders.find((o) => o.id === id) });
      }
      if (p === '/paper/account') return route.fulfill({ json: PAPER_ACCOUNT });
      if (p === '/paper/quotes') return route.fulfill({ json: PAPER_QUOTES });
      if (p === '/paper/holdings') return route.fulfill({ json: PAPER_HOLDINGS });
      if (p === '/paper/fills') return route.fulfill({ json: PAPER_FILLS });
      if (p === '/paper/charges') return route.fulfill({ json: PAPER_CHARGES });
      if (p === '/paper/orders/preview') return route.fulfill({ json: PAPER_PREVIEW });
      if (p === '/paper/orders' && method === 'GET') return route.fulfill({ json: fake.orders });
      if (p === '/paper/orders') {
        if (opts.refuse) return route.fulfill({ status: 422, json: PAPER_NO_FUNDS });
        const filled = PAPER_ORDERS.find((o) => o.status === 'FILLED')!;
        const placed = { ...filled, id: '0e000000-0000-4000-8000-000000000099', quantity: 10 };
        fake.orders = [placed, ...fake.orders];
        return route.fulfill({ status: 201, json: placed });
      }
      const id = p.split('/')[3];
      if (method === 'DELETE') {
        fake.orders = fake.orders.map((o) =>
          o.id === id ? { ...o, status: 'CANCELLED', status_message: 'Cancelled by you.' } : o,
        );
        return route.fulfill({ json: fake.orders.find((o) => o.id === id) });
      }
      return route.fulfill({ status: 404, json: { detail: 'Order not found.' } });
    },
  );
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
  await page.goto(path);
  return fake;
}

const RELIANCE_ID = INSTRUMENTS_FIXTURE[0]!.id;

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('the account, watchlist and order book show the backend values; a buy is placed', async ({
  page,
}) => {
  const fake = await open(page, '/app/paper');
  await expect(page).toHaveURL(/\/app\/live\?tab=account$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Live Trading (Paper)' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Paper account', selected: true })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Account summary' });
  await expect(summary).toContainText(formatINR(PAPER_ACCOUNT.equity));
  await expect(page.getByRole('status', { name: 'Market status' })).toContainText(
    'NSE market open',
  );
  const reliance = page
    .getByRole('list', { name: 'Watchlist instruments' })
    .getByRole('listitem', { name: 'RELIANCE' });
  await expect(reliance).toContainText(formatINR(PAPER_QUOTES[0]!.quote!.price));
  await expect(page.getByRole('table', { name: 'Open orders' }).getByRole('row')).toHaveCount(3);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await reliance.getByRole('button', { name: 'Buy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Quantity/).fill('10');
  const estimate = dialog.getByRole('region', { name: 'Order estimate' });
  await expect(estimate).toContainText(formatINR(PAPER_PREVIEW.estimated_total));
  await dialog.getByRole('button', { name: 'Place buy order' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/filled at/)).toBeVisible();
  expect(fake.bodies.at(-1)).toEqual({
    method: 'POST',
    path: '/paper/orders',
    body: {
      instrument_id: INSTRUMENTS_FIXTURE[0]!.id,
      side: 'BUY',
      order_type: 'MARKET',
      quantity: 10,
      price: null,
      trigger_price: null,
    },
  });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('cancel asks first; the order book, holdings and fills tabs keep their place', async ({
  page,
}) => {
  const fake = await open(page, '/app/live?tab=account');
  const open_ = page.getByRole('table', { name: 'Open orders' });
  await open_.getByRole('button', { name: /^Cancel BUY 100 NIFTYBEES/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(open_.getByRole('row')).toHaveCount(2);
  expect(fake.bodies.at(-1)?.method).toBe('DELETE');

  await page.getByRole('tab', { name: 'Order book' }).click();
  await expect(page).toHaveURL(/tab=account&view=book/);
  await expect(page.getByRole('table', { name: 'Order book' }).getByRole('row')).toHaveCount(
    PAPER_ORDERS.length + 1,
  );
  await page.getByRole('tab', { name: 'Holdings' }).click();
  await expect(page.getByRole('table', { name: 'Holdings' })).toContainText(
    formatINR(PAPER_HOLDINGS[0]!.market_value),
  );
  await page.getByRole('tab', { name: 'Fills' }).click();
  await expect(page.getByRole('table', { name: 'Fills' })).toContainText(
    formatINR(PAPER_FILLS[0]!.total_charges),
  );
  await page.reload();
  await expect(page.getByRole('table', { name: 'Fills' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("the backend's refusal is shown in the ticket", async ({ page }) => {
  await open(page, '/app/live?tab=account', { refuse: true });
  const reliance = page
    .getByRole('list', { name: 'Watchlist instruments' })
    .getByRole('listitem', { name: 'RELIANCE' });
  await reliance.getByRole('button', { name: 'Buy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Place buy order' }).click();
  await expect(dialog.getByRole('alert').first()).toContainText(PAPER_NO_FUNDS.detail);
});

test('a strategy is deployed; its page shows the daily log; pause and stop', async ({ page }) => {
  const fake = await open(page, '/app/paper?tab=strategies');
  await expect(page).toHaveURL(/\/app\/live\?tab=deployments$/);
  const list = page.getByRole('table', { name: 'Strategy deployments' });
  await expect(list.getByRole('row')).toHaveCount(DEPLOY_DEPLOYMENTS.length + 1);
  await page.getByRole('button', { name: 'Run due days now' }).click();
  await expect(page.getByText(/Processed 3 deployment days through/)).toBeVisible();

  await page.getByRole('button', { name: /Deploy strategy/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: /Strategy/ }).selectOption(SMA3.id);
  await dialog.getByRole('combobox', { name: /Instrument/ }).selectOption(RELIANCE_ID);
  await dialog.getByLabel(/Quantity/).fill('20');
  await dialog.getByLabel(/Capital/).fill('200000');
  await dialog.getByLabel(/Loss limit/).fill('10');
  await dialog.getByRole('button', { name: 'Deploy' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/live/deployments/${DEPLOY_DEPLOYMENT.id}$`));
  expect(fake.bodies.at(-1)).toEqual({
    method: 'POST',
    path: '/paper/deployments',
    body: {
      strategy_id: SMA3.id,
      instrument_id: RELIANCE_ID,
      other_instrument_ids: [],
      quantity: 20,
      capital: 200000,
      loss_limit: 0.1,
      duration_days: 30,
    },
  });

  await expect(page.getByRole('heading', { level: 1, name: DEPLOY_DEPLOYMENT.name })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Deployment performance' })).toContainText(
    formatINR(DEPLOY_DEPLOYMENT.performance.end_value),
  );
  await expect(page.getByRole('table', { name: 'Daily log' }).getByRole('row')).toHaveCount(
    DEPLOY_DEPLOYMENT.days.length + 1,
  );
  await expect(page.getByRole('img', { name: /Deployment value at each close/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop deployment' }).click();
  await expect(page.getByText('Stopped by you.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0);
});

test('the performance tab charts the account; the journal keeps a note', async ({ page }) => {
  const fake = await open(page, '/app/live?tab=performance');
  await expect(page.getByRole('region', { name: 'Account performance' })).toContainText(
    formatPercent(DEPLOY_PERFORMANCE.performance.total_return),
  );
  await expect(page.getByRole('img', { name: /Account value at each close/ })).toHaveAttribute(
    'data-total-points',
    String(DEPLOY_PERFORMANCE.snapshots.length),
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('tab', { name: 'Paper account' }).click();
  await page.getByRole('tab', { name: 'Order book' }).click();
  const book = page.getByRole('table', { name: 'Order book' });
  const order = PAPER_ORDERS[0]!;
  await book
    .getByRole('button', { name: `Journal for ${order.side} ${order.quantity} ${order.symbol}` })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Trade journal' });
  await dialog.getByLabel(/Note/).fill('Bought the dip');
  await dialog.getByLabel(/Tags/).fill('dip, swing');
  await dialog.getByRole('button', { name: 'Save journal' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(book).toContainText('Bought the dip');
  expect(fake.bodies.at(-1)).toEqual({
    method: 'PATCH',
    path: `/paper/orders/${order.id}/journal`,
    body: { note: 'Bought the dip', tags: ['dip', 'swing'] },
  });
});
