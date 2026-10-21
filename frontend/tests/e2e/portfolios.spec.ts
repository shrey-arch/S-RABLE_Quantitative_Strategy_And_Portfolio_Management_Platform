import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import {
  PORTFOLIO_ACCOUNT_EMPTY,
  PORTFOLIO_ACCOUNT_SAVED,
  PORTFOLIO_CURRENT_REGIME,
  PORTFOLIO_PRICES,
  PORTFOLIO_REBALANCE,
  PORTFOLIO_SCORES,
  PORTFOLIO_TARGET_LIMITS,
} from '../../src/features/portfolios/portfolio-fixture';

/**
 * Phase 14: portfolio orchestration in a real browser. A fake of the API keeps the
 * saved state in memory and answers calculations with the backend's own results.
 */

const USER = {
  id: 'u-1',
  full_name: 'Portfolio Test',
  email: 'p@example.com',
  account_status: 'ACTIVE',
};
const ID = PORTFOLIO_ACCOUNT_EMPTY.id;

interface Fake {
  saved: typeof PORTFOLIO_ACCOUNT_EMPTY | null;
  created: unknown[];
  targets: unknown[];
  rebalances: unknown[];
  puts: unknown[];
}

/** A list item (GET /portfolio/accounts) of a saved portfolio. */
const summary = (a: typeof PORTFOLIO_ACCOUNT_EMPTY) => ({
  id: a.id,
  name: a.name,
  description: a.description,
  initial_capital: a.initial_capital,
  cash: a.cash,
  invested_value: a.invested_value,
  total_equity: a.total_equity,
  holdings_count: a.holdings.length,
  simulation_only: true,
});

async function open(page: Page, path: string) {
  const fake: Fake = { saved: null, created: [], targets: [], rebalances: [], puts: [] };
  await page.route(
    (url) =>
      [
        '/users/me',
        '/scoring',
        '/regime/current',
        '/strategies',
        '/brokers/accounts',
        '/instruments',
      ].includes(url.pathname) || url.pathname.startsWith('/portfolio/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const p = new URL(request.url()).pathname;
      const method = request.method();
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/scoring') return route.fulfill({ json: PORTFOLIO_SCORES });
      if (p === '/regime/current') return route.fulfill({ json: PORTFOLIO_CURRENT_REGIME });
      if (['/strategies', '/brokers/accounts', '/instruments'].includes(p))
        return route.fulfill({ json: [] });
      if (p === '/portfolio/prices') return route.fulfill({ json: PORTFOLIO_PRICES });
      if (p === '/portfolio/target') {
        fake.targets.push(request.postDataJSON());
        return route.fulfill({ json: PORTFOLIO_TARGET_LIMITS });
      }
      if (p === '/portfolio/rebalance') {
        fake.rebalances.push(request.postDataJSON());
        return route.fulfill({ json: PORTFOLIO_REBALANCE });
      }
      if (p === '/portfolio/accounts' && method === 'POST') {
        const body = request.postDataJSON() as { name: string; initial_capital: string };
        fake.created.push(body);
        fake.saved = { ...PORTFOLIO_ACCOUNT_EMPTY, name: body.name };
        return route.fulfill({ status: 201, json: summary(fake.saved) });
      }
      if (p === '/portfolio/accounts') {
        if (!fake.saved) return route.fulfill({ json: [] });
        return route.fulfill({ json: [summary(fake.saved)] });
      }
      if (p === `/portfolio/accounts/${ID}/state` && fake.saved) {
        fake.puts.push(request.postDataJSON());
        fake.saved = { ...PORTFOLIO_ACCOUNT_SAVED, name: fake.saved.name };
        return route.fulfill({ json: fake.saved });
      }
      if (p === `/portfolio/accounts/${ID}` && fake.saved)
        return route.fulfill({ json: fake.saved });
      return route.fulfill({ status: 404, json: { detail: 'Portfolio not found.' } });
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

test('create -> target -> rebalance -> save -> reload shows the saved state', async ({ page }) => {
  const fake = await open(page, '/app/portfolios');
  await expect(page.getByText('No portfolios yet')).toBeVisible();
  await page
    .getByRole('button', { name: /New portfolio/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /Name/ }).fill('Core portfolio');
  await dialog.getByRole('textbox', { name: /Initial capital/ }).fill('1000000');
  await dialog.getByRole('button', { name: 'Create portfolio' }).dblclick();
  await expect(page).toHaveURL(new RegExp(`/app/portfolios/${ID}$`));
  expect(fake.created).toEqual([
    { name: 'Core portfolio', description: null, initial_capital: '1000000' },
  ]);
  await expect(page.getByRole('group', { name: 'Saved state' })).toContainText('10,00,000.00');

  // Target allocation: a calculation, nothing saved.
  await page.getByRole('tab', { name: 'Target allocation' }).click();
  await expect(page.getByRole('note').first()).toContainText('no orders are placed');
  await expect(page.getByRole('combobox', { name: 'Regime' })).toHaveValue(
    PORTFOLIO_CURRENT_REGIME.regime.code,
  );
  await page.getByRole('textbox', { name: /Cash reserve/ }).fill('100000');
  await page.getByRole('textbox', { name: /Max strategy weight/ }).fill('30');
  await page.getByRole('textbox', { name: /Max asset weight/ }).fill('45');
  await page.getByRole('button', { name: 'Calculate target' }).click();
  const selected = page.getByRole('table', { name: 'Selected strategies' });
  await expect(selected.getByRole('row')).toHaveCount(PORTFOLIO_TARGET_LIMITS.positions.length + 3);
  await expect(
    page.getByRole('list', { name: 'Binding limits' }).getByRole('listitem'),
  ).toHaveCount(PORTFOLIO_TARGET_LIMITS.binding_limits.length);
  expect(fake.targets).toHaveLength(1);
  expect(fake.puts).toHaveLength(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // Rebalance plan, then apply it and save.
  await page.getByRole('tab', { name: 'Rebalance plan' }).click();
  await page.getByRole('button', { name: 'Calculate rebalance plan' }).click();
  const plan = page.getByRole('table', { name: 'Rebalance plan by asset' });
  for (const a of PORTFOLIO_REBALANCE.assets)
    await expect(plan.locator(`[data-asset="${a.asset}"]`)).toContainText(a.action);
  expect(fake.rebalances).toHaveLength(1);
  expect(fake.puts).toHaveLength(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Use this result to edit and save' }).click();
  await page.getByRole('button', { name: /Save state/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).dblclick();
  await expect(page.getByText('Portfolio state saved.')).toBeVisible();
  const ending = PORTFOLIO_REBALANCE.ending_state!;
  expect(fake.puts).toEqual([
    {
      cash: ending.cash,
      holdings: Object.fromEntries(
        ending.holdings.map((h) => [h.asset, { quantity: h.quantity, price: h.price }]),
      ),
    },
  ]);

  // Reload: the saved state comes back from the API.
  await page.reload();
  const holdings = page.getByRole('table', { name: 'Holdings' });
  for (const h of PORTFOLIO_ACCOUNT_SAVED.holdings) await expect(holdings).toContainText(h.asset);
  await expect(page.getByRole('group', { name: 'Saved state' })).toContainText('1,04,133.78');
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("another user's portfolio id shows not available, with no data", async ({ page }) => {
  await open(page, '/app/portfolios/00000000-0000-4000-8000-00000000abcd');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Portfolio not available' }),
  ).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
});
