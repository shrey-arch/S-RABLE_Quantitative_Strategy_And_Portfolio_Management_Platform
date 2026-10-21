import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import {
  RECORDS_EXECUTION_ID,
  RECORDS_EXECUTIONS,
  RECORDS_ORDERS,
  RECORDS_POSITIONS,
  RECORDS_REFUSED,
  RECORDS_STRATEGY,
  RECORDS_TRADES,
} from '../../src/features/records/records-fixture';

/**
 * Phase 15: trading records in a real browser. A fake of the API filters the
 * backend's own records as the backend does and keeps deletes in memory.
 */

const USER = {
  id: 'u-1',
  full_name: 'Records Test',
  email: 'rec@example.com',
  account_status: 'ACTIVE',
};

interface Fake {
  orders: typeof RECORDS_ORDERS;
  queries: Record<string, string>[];
  actions: string[];
  deletes: string[];
}

async function open(page: Page, path: string) {
  const fake: Fake = { orders: [...RECORDS_ORDERS], queries: [], actions: [], deletes: [] };
  await page.route(
    (url) =>
      ['/users/me', '/executions', '/strategies', '/instruments'].includes(url.pathname) ||
      /^\/(orders|trades|positions)(\/|$)/.test(url.pathname),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const p = url.pathname;
      const q = Object.fromEntries(url.searchParams);
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/executions') return route.fulfill({ json: RECORDS_EXECUTIONS });
      if (p === '/strategies') return route.fulfill({ json: [RECORDS_STRATEGY] });
      if (p === '/instruments') return route.fulfill({ json: INSTRUMENTS_FIXTURE });
      if (p === '/orders') {
        fake.queries.push(q);
        return route.fulfill({
          json: fake.orders.filter(
            (o) =>
              (!q.side || o.order_side === q.side) &&
              (!q.status || o.status === q.status) &&
              (!q.instrument_id || o.instrument_id === q.instrument_id) &&
              (!q.execution_id || o.execution_id === q.execution_id),
          ),
        });
      }
      if (p === '/trades')
        return route.fulfill({
          json: RECORDS_TRADES.filter(
            (t) =>
              fake.orders.some((o) => o.id === t.order_id) &&
              (!q.order_id || t.order_id === q.order_id),
          ),
        });
      if (p === '/positions')
        return route.fulfill({
          json: RECORDS_POSITIONS.filter(
            (x) =>
              (!q.instrument_id || x.instrument_id === q.instrument_id) &&
              (!q.status || x.position_status === q.status),
          ),
        });
      const [, kind, id, action] = p.split('/');
      if (kind === 'orders' && action) {
        fake.actions.push(action);
        return route.fulfill({ status: 400, json: RECORDS_REFUSED });
      }
      if (request.method() === 'DELETE') {
        fake.deletes.push(`${kind}/${id}`);
        fake.orders = fake.orders.filter((o) => o.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      const all = [...fake.orders, ...RECORDS_TRADES, ...RECORDS_POSITIONS] as { id: string }[];
      const found = all.find((x) => x.id === id);
      return found
        ? route.fulfill({ json: found })
        : route.fulfill({ status: 404, json: { detail: 'Not found.' } });
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

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('all three record types are listed, filtered and linked to their execution', async ({
  page,
}) => {
  const fake = await open(page, '/app/records');
  await expect(page.getByRole('heading', { level: 1, name: 'Trading Records' })).toBeVisible();
  const orders = page.getByRole('table', { name: 'Orders' }).getByRole('row');
  await expect(orders).toHaveCount(RECORDS_ORDERS.length + 1);
  // Names come from the run and strategy lists, which may arrive after the records.
  await expect(orders.nth(1)).toContainText('Momentum flip', { timeout: 20_000 });

  await page.getByRole('combobox', { name: 'Side' }).selectOption('SELL');
  await expect(orders).toHaveCount(3);
  await expect(page).toHaveURL(/side=SELL/);
  expect(fake.queries.at(-1)).toEqual({ side: 'SELL' });
  await page.getByRole('combobox', { name: 'Execution' }).selectOption(RECORDS_EXECUTION_ID);
  await expect(page).toHaveURL(new RegExp(`execution=${RECORDS_EXECUTION_ID}`));
  await expect
    .poll(() => fake.queries.at(-1))
    .toEqual({ side: 'SELL', execution_id: RECORDS_EXECUTION_ID });
  await page.reload();
  await expect(orders).toHaveCount(3);

  // Order -> trades -> position, and the execution's results.
  await orders.nth(1).click();
  const drawer = page.getByRole('dialog');
  const chain = drawer.getByRole('list', { name: 'Relationship chain' });
  await expect(chain.getByRole('link', { name: /Backtest results/ })).toHaveAttribute(
    'href',
    `/app/executions/${RECORDS_EXECUTION_ID}/results`,
  );
  await expect(chain).toContainText('Trades (1)');
  await chain
    .getByRole('button', { name: /^Open / })
    .first()
    .click();
  await expect(page).toHaveURL(/record=position%3A/);
  await expect(page.getByRole('dialog')).toContainText(
    'Unrealised P&L = (current price - average price) x quantity',
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');

  for (const tab of ['Trades', 'Positions']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('table', { name: tab }).getByRole('row').nth(1)).toContainText(
      'Momentum flip',
    );
  }
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('maintenance is behind Advanced, asks first, and shows the backend 400 reason', async ({
  page,
}) => {
  const order = RECORDS_ORDERS[0]!;
  const fake = await open(page, `/app/records?record=order:${order.id}`);
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('list', { name: 'Relationship chain' })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Record maintenance' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const advanced = page.getByRole('switch', { name: /Advanced/ });
  await advanced.click();
  await expect(advanced).toBeChecked();
  await expect(page.getByRole('note')).toContainText('Simulated record maintenance');
  await page.getByRole('table', { name: 'Orders' }).getByRole('row').nth(1).click();
  const tools = page.getByRole('dialog').getByRole('region', { name: 'Record maintenance' });
  await tools.getByRole('button', { name: 'Mark cancelled' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Mark cancelled' }).click();
  await expect(tools.getByRole('alert')).toHaveText(RECORDS_REFUSED.detail);
  expect(fake.actions).toEqual(['cancel']);

  await tools.getByRole('button', { name: /Delete order/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).dblclick();
  // The confirmation hides the drawer while open: wait for both to be gone.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => fake.deletes.length).toBe(1);
  await expect(page.getByRole('table', { name: 'Orders' }).getByRole('row')).toHaveCount(
    RECORDS_ORDERS.length,
  );
});
