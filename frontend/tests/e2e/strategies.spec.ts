import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { REGISTRY_FIXTURE } from '../../src/features/strategies/registry-fixture';

/**
 * Phase 5: the strategy library in a real browser. A small in-memory fake of the
 * strategy API answers fetch requests, so saved changes survive a page reload.
 */

const USER = {
  id: 'u-1',
  full_name: 'Strat Test',
  email: 's@example.com',
  account_status: 'ACTIVE',
};

interface FakeStrategy {
  id: string;
  name: string;
  is_active: boolean;
  version: number;
  description?: string | null;
  strategy_type?: string;
  strategy_config?: Record<string, unknown>;
}

/** Like StrategyRegistry.get: windows and lookbacks must be above 0. */
function fakeValidate(parameters: Record<string, unknown>) {
  for (const [name, value] of Object.entries(parameters)) {
    if (/lookback|window/.test(name) && typeof value === 'number' && value <= 0) {
      return `${name} must be greater than 0.`;
    }
  }
  return null;
}

const listHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Strategies' });

async function openStrategies(page: Page, mine: FakeStrategy[], path = '/app/strategies') {
  const store = new Map(mine.map((s) => [s.id, { ...s }]));
  let nextId = 1;
  const full = (s: FakeStrategy) => ({
    user_id: USER.id,
    description: null,
    strategy_type: 'NO_CODE',
    strategy_config: {},
    created_at: '2026-10-01T10:00:00+00:00',
    updated_at: '2026-10-02T04:30:00+00:00',
    ...s,
  });

  await page.route(
    (url) =>
      url.pathname === '/users/me' ||
      url.pathname.startsWith('/strategy-registry') ||
      url.pathname.startsWith('/strategies'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const path = new URL(request.url()).pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      if (path === '/strategy-registry') return route.fulfill({ json: REGISTRY_FIXTURE });
      if (path.endsWith('/validate')) {
        const { parameters } = request.postDataJSON() as { parameters: Record<string, unknown> };
        const problem = fakeValidate(parameters);
        return problem
          ? route.fulfill({ status: 422, json: { detail: problem } })
          : route.fulfill({
              json: { strategy_key: path.split('/')[2], effective_parameters: parameters },
            });
      }
      if (path === '/strategies' && request.method() === 'POST') {
        const body = request.postDataJSON() as Omit<FakeStrategy, 'id' | 'version' | 'is_active'>;
        const created: FakeStrategy = {
          ...body,
          id: `new-${nextId++}`,
          version: 1,
          is_active: true,
        };
        store.set(created.id, created);
        return route.fulfill({ status: 201, json: full(created) });
      }
      if (path === '/strategies') return route.fulfill({ json: [...store.values()].map(full) });

      const item = store.get(path.split('/')[2] ?? '');
      if (!item) return route.fulfill({ status: 404, json: { detail: 'Strategy not found.' } });
      // The backend keeps the version unchanged on PATCH.
      if (request.method() === 'PATCH') Object.assign(item, request.postDataJSON());
      if (request.method() === 'DELETE') {
        store.delete(item.id);
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: full(item) });
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
}

test('all five core strategies render from the registry API', async ({ page }) => {
  await openStrategies(page, []);
  await expect(listHeading(page)).toBeVisible();
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(5);
  await expect(cards.getByRole('heading', { level: 3 })).toHaveText([
    'Momentum',
    'Mean Reversion',
    'Volatility Arbitrage',
    'Statistical Arbitrage',
    'Tactical Asset Allocation',
  ]);
  await expect(page.getByRole('article', { name: 'Momentum' })).toContainText('Can be backtested');
  await expect(page.getByRole('article', { name: 'Statistical Arbitrage' })).toContainText(
    'Runs on two instruments (A and B).',
  );
  await expect(page.getByText('No strategies yet')).toBeVisible();

  // Nothing spills sideways (phones included).
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('toggling a strategy is saved and survives a reload', async ({ page }) => {
  await openStrategies(page, [
    { id: 's1', name: 'Alpha', is_active: true, version: 1 },
    { id: 's2', name: 'Beta', is_active: false, version: 4 },
  ]);
  await expect(listHeading(page)).toBeVisible();
  const alpha = page.getByRole('switch', { name: 'Active: Alpha' });
  await expect(alpha).toBeChecked();
  await expect(page.getByRole('row', { name: /Alpha/ })).toContainText('v1');

  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith('/strategies/s1'),
  );
  await alpha.click();
  expect((await saved).request().postDataJSON()).toEqual({ is_active: false });
  await expect(alpha).not.toBeChecked();
  // The refreshed list shows what the server saved.
  await expect(page.getByRole('row', { name: /Alpha/ })).toContainText('v1');
  await expect(page.getByRole('switch', { name: 'Active: Beta' })).not.toBeChecked();

  await page.reload();
  await expect(page.getByRole('switch', { name: 'Active: Alpha' })).not.toBeChecked();
});

test('the switch works from the keyboard', async ({ page }) => {
  await openStrategies(page, [{ id: 's1', name: 'Alpha', is_active: false, version: 1 }]);
  await expect(listHeading(page)).toBeVisible();
  const alpha = page.getByRole('switch', { name: 'Active: Alpha' });
  await alpha.focus();
  await page.keyboard.press('Space');
  await expect(alpha).toBeChecked();
});

test('a strategy opens from the list and shows its details', async ({ page }) => {
  // Made from a core template, so it can be backtested (no-code ones cannot yet).
  await openStrategies(page, [
    {
      id: 's1',
      name: 'Alpha',
      is_active: true,
      version: 2,
      strategy_type: 'PYTHON',
      strategy_config: {
        parameters: { template: 'momentum', lookback: 20 },
        indicators: [],
        entry_conditions: [],
        exit_conditions: [],
      },
    },
  ]);
  await page.getByRole('link', { name: 'Alpha' }).click();
  await expect(page).toHaveURL(/\/app\/strategies\/s1$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha' })).toBeVisible();
  await expect(page.getByText('Version 2')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Backtest', exact: true })).toHaveAttribute(
    'href',
    '/app/backtests/new?strategy=s1',
  );
});

test('deleting is confirmed, saved, and the list no longer shows it', async ({ page }) => {
  await openStrategies(
    page,
    [
      { id: 's1', name: 'Alpha', is_active: true, version: 1 },
      { id: 's2', name: 'Beta', is_active: true, version: 1 },
    ],
    '/app/strategies/s1',
  );
  await page.getByRole('button', { name: /Delete/ }).click();
  const deleted = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().endsWith('/strategies/s1'),
  );
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete strategy' }).click();
  expect((await deleted).status()).toBe(204);

  await expect(listHeading(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beta' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alpha' })).toHaveCount(0);

  // The old address now says not available.
  await page.goto('/app/strategies/s1');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Strategy not available' }),
  ).toBeVisible();
});

test("another user's strategy id shows not available, with no data", async ({ page }) => {
  // The fake server, like the backend, answers 404 for ids that are not the user's.
  await openStrategies(
    page,
    [{ id: 's1', name: 'Alpha', is_active: true, version: 1 }],
    '/app/strategies/someone-elses-id',
  );
  await expect(
    page.getByRole('heading', { level: 1, name: 'Strategy not available' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to strategies' }).click();
  await expect(listHeading(page)).toBeVisible();
});

test('a core template becomes a saved user strategy, listed after creating', async ({ page }) => {
  await openStrategies(page, []);
  await page.getByRole('button', { name: 'Use Momentum as a template' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^Name/)).toHaveValue('Momentum (copy)');
  await dialog.getByLabel(/^Name/).fill('Nifty trend');
  await dialog.getByLabel('lookback').fill('50');

  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/strategies'),
  );
  await dialog.getByRole('button', { name: 'Create strategy' }).click();
  expect((await created).request().postDataJSON()).toMatchObject({
    name: 'Nifty trend',
    strategy_type: 'PYTHON',
    strategy_config: { parameters: { template: 'momentum', lookback: 50 } },
  });

  // Lands on the new strategy; the list includes it.
  await expect(page.getByRole('heading', { level: 1, name: 'Nifty trend' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText('50');
  await page
    .getByRole('main')
    .getByRole('link', { name: /Strategies$/ })
    .click();
  await expect(page.getByRole('link', { name: 'Nifty trend' })).toBeVisible();
});

test('bad parameter values show under the field and nothing is saved', async ({ page }) => {
  await openStrategies(page, []);
  await page.getByRole('button', { name: 'New strategy' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Name/).fill('Broken');
  await dialog.getByLabel('lookback').fill('0');
  await dialog.getByRole('button', { name: 'Create strategy' }).click();
  await expect(dialog.getByText('lookback must be greater than 0.')).toBeVisible();
  await expect(dialog.getByLabel('lookback')).toHaveAttribute('aria-invalid', 'true');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No strategies yet')).toBeVisible();
});

test('editing saves and survives a reload', async ({ page }) => {
  await openStrategies(
    page,
    [
      {
        id: 's1',
        name: 'Alpha',
        is_active: true,
        version: 1,
        strategy_type: 'PYTHON',
        strategy_config: {
          parameters: { template: 'momentum', lookback: 20 },
          indicators: [],
          entry_conditions: [],
          exit_conditions: [],
        },
      },
    ],
    '/app/strategies/s1',
  );
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Name/).fill('Alpha renamed');
  await dialog.getByLabel('lookback').fill('35');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('heading', { level: 1, name: 'Alpha renamed' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Alpha renamed' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Parameters' })).toContainText('35');
});

test('duplicating creates a separate copy; the original is unchanged', async ({ page }) => {
  await openStrategies(
    page,
    [
      {
        id: 's1',
        name: 'Alpha',
        is_active: true,
        version: 1,
        strategy_type: 'PYTHON',
        strategy_config: {
          parameters: { template: 'momentum', lookback: 20 },
          indicators: [],
          entry_conditions: [],
          exit_conditions: [],
        },
      },
    ],
    '/app/strategies/s1',
  );
  await page.getByRole('button', { name: 'Duplicate' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^Name/)).toHaveValue('Alpha (copy)');
  await dialog.getByRole('button', { name: 'Create strategy' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Alpha (copy)' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/strategies\/new-1$/);
  await page.goto('/app/strategies');
  await expect(page.getByRole('link', { name: 'Alpha', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Alpha (copy)' })).toBeVisible();
});
