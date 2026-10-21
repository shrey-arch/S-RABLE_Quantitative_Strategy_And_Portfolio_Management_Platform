import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { LIVE_STATUS } from '../../src/features/live/live-fixture';
import { PAPER_ACCOUNT, PAPER_CHARGES } from '../../src/features/paper/paper-fixture';
import { NAV_GROUPS, type NavItem } from '../../src/app/nav';
import { APP_ROUTES, UNAVAILABLE_ROUTES } from '../../src/app/routes';
import {
  REGIME_FIT_UNKNOWN,
  SCORING_DEFINITIONS,
} from '../../src/features/scoring/scoring-fixture';

/**
 * Phase 3: the app shell, logged in. No backend needed: the browser gets a stand-in
 * token, and GET /users/me plus the dashboard's list calls are answered by the test
 * (page.route), never by the server.
 */

const NEW_PAPER_ACCOUNT = {
  ...PAPER_ACCOUNT,
  cash: 1000000,
  blocked_cash: 0,
  available_cash: 1000000,
  invested: 0,
  holdings_value: 0,
  unrealised_pnl: 0,
  total_charges: 0,
  equity: 1000000,
  total_pnl: 0,
  holdings_count: 0,
  watchlist: [],
};

const SAMPLE_ID = '00000000-0000-0000-0000-000000000001';
const toUrl = (path: string) => path.replace(':id', SAMPLE_ID);
const NAV_LINKS = NAV_GROUPS.flatMap((g) => g.items).filter((i): i is NavItem => !i.planned);

const USER = {
  id: 'u-1',
  full_name: 'Shell Test',
  email: 'shell@example.com',
  account_status: 'ACTIVE',
  email_verified: false,
  phone_number: null,
  profile_image_url: null,
  last_login_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

/** API calls the dashboard makes; answered with empty lists (the user has no data). */
const EMPTY_LIST_APIS = [
  '/strategies',
  '/strategy-registry',
  '/brokers/accounts',
  '/instruments',
  '/indicators',
  '/portfolio/accounts',
  '/executions',
  '/validations',
  '/portfolio-backtests',
  '/orders',
  '/trades',
  '/positions',
  '/notifications',
  '/live/sessions',
];

async function logIn(page: Page) {
  await page.route('**/users/me', (route) => route.fulfill({ json: USER }));
  // Detail pages ask for one record by id; the sample id is not the user's.
  await page.route(
    (url) =>
      url.pathname.startsWith('/strategies/') ||
      url.pathname.startsWith('/instruments/') ||
      url.pathname.startsWith('/executions/') ||
      url.pathname.startsWith('/validations/') ||
      url.pathname.startsWith('/portfolio-backtests/') ||
      url.pathname.startsWith('/portfolio/accounts/'),
    (route) =>
      route.request().resourceType() === 'fetch'
        ? route.fulfill({ status: 404, json: { detail: 'Not found.' } })
        : route.continue(),
  );
  // A new paper account: Rs 10,00,000, nothing traded, an empty watchlist.
  await page.route(
    (url) => url.pathname.startsWith('/paper/'),
    (route) => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      const p = new URL(route.request().url()).pathname;
      if (p === '/paper/account') return route.fulfill({ json: NEW_PAPER_ACCOUNT });
      if (p === '/paper/charges') return route.fulfill({ json: PAPER_CHARGES });
      // Detail pages: the sample deployment id is not the user's.
      if (p.startsWith('/paper/deployments/') && route.request().method() === 'GET')
        return route.fulfill({ status: 404, json: { detail: 'Deployment not found.' } });
      return route.fulfill({ json: [] });
    },
  );
  // Feature 7: no live sessions; the market is closed; the sample session is not the user's.
  await page.route(
    (url) => url.pathname.startsWith('/live/'),
    (route) => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      const p = new URL(route.request().url()).pathname;
      if (p === '/live/status') return route.fulfill({ json: LIVE_STATUS });
      if (p.startsWith('/live/sessions/'))
        return route.fulfill({ status: 404, json: { detail: 'Live session not found.' } });
      return route.fulfill({ json: [] });
    },
  );
  // No regime model has been trained: no models, and no current regime or history.
  await page.route(
    (url) => url.pathname.startsWith('/regime/'),
    (route) =>
      route.request().resourceType() !== 'fetch'
        ? route.continue()
        : new URL(route.request().url()).pathname === '/regime/models'
          ? route.fulfill({ json: [] })
          : route.fulfill({
              status: 404,
              json: { detail: 'No regime model has been trained yet.' },
            }),
  );
  // Nothing scored yet: no saved strategies, and no regime model.
  const NO_SCORES = { regime: null, weights: {}, custom_weights: false, rows: [] };
  await page.route(
    (url) => url.pathname === '/scoring' || url.pathname.startsWith('/scoring/'),
    (route) => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      const p = new URL(route.request().url()).pathname;
      if (p === '/scoring/definitions') return route.fulfill({ json: SCORING_DEFINITIONS });
      if (p === '/scoring/regime-fit') return route.fulfill({ json: REGIME_FIT_UNKNOWN });
      return route.fulfill({ json: NO_SCORES });
    },
  );
  // Only API requests (fetch), never page loads such as /app/strategies.
  await page.route(
    (url) => EMPTY_LIST_APIS.includes(url.pathname),
    (route) =>
      route.request().resourceType() === 'fetch' ? route.fulfill({ json: [] }) : route.continue(),
  );
  await quietBell(page);
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
}

test.beforeEach(async ({ page }) => {
  await logIn(page);
});

// One test per route: each gets its own time limit, and a failure names the route.
for (const route of APP_ROUTES) {
  test(`route ${route.path} loads by direct URL and survives a refresh`, async ({ page }) => {
    await page.goto(toUrl(route.path));
    const heading = page.getByRole('heading', { level: 1, name: route.title });
    await expect(heading).toBeVisible();
    await expect(page).toHaveTitle(`${route.title} \u00b7 S-RABLE`);
    await page.reload();
    await expect(heading).toBeVisible();
  });
}

for (const route of UNAVAILABLE_ROUTES) {
  test(`route ${route.path} shows "${route.reason}" and no data`, async ({ page }) => {
    await page.goto(toUrl(route.path));
    const text = route.reason === 'planned' ? 'is planned' : 'is not available';
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${route.title} ${text}`);
  });
}

test('an unknown /app address shows "Page not found" inside the app', async ({ page }) => {
  await page.goto('/app/does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
});

test('the active section is highlighted (desktop sidebar)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop sidebar');
  test.setTimeout(60_000); // visits every sidebar page
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const item of NAV_LINKS) {
    await page.goto(item.to);
    await expect(nav.locator('[aria-current="page"]')).toHaveText(item.label);
  }
  // Pages inside a section keep the section highlighted.
  await page.goto(`/app/strategies/${SAMPLE_ID}`);
  await expect(nav.locator('[aria-current="page"]')).toHaveText('Strategies');
});

test('keyboard: skip link, sidebar, then header controls', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard test uses the desktop layout');
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // First Tab: skip link; Enter moves focus to the page content.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  // From the top: Tab visits every sidebar link in order, then the header controls.
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const visited: string[] = [];
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ??
        document.activeElement?.textContent?.trim() ??
        '',
    );
    visited.push(name);
    if (name === 'Account menu') break;
  }
  const sidebarOrder = visited.filter((n) => NAV_LINKS.some((l) => l.label === n));
  expect(sidebarOrder).toEqual(NAV_LINKS.map((l) => l.label));
  expect(visited.indexOf('Account menu')).toBeGreaterThan(visited.indexOf('Profile'));
  // The bell sits between the theme switch and the account menu.
  const bell = visited.findIndex((n) => n.startsWith('Notifications, '));
  expect(bell).toBeGreaterThan(visited.indexOf('Profile'));
  expect(bell).toBeLessThan(visited.indexOf('Account menu'));

  // The user menu opens and is usable with the keyboard.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeVisible();
  await page.keyboard.press('Home'); // first menu item
  await expect(page.getByRole('menuitem', { name: 'Profile' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/app\/profile$/);
});

test('mobile: menu button opens the sidebar, choosing a page closes it', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto(`/app/strategies/${SAMPLE_ID}`);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();

  await page.getByRole('button', { name: 'Open menu' }).click();
  const menu = page.getByRole('dialog');
  await expect(menu.locator('[aria-current="page"]')).toHaveText('Strategies');
  await menu.getByRole('link', { name: 'Portfolios' }).click();
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(/\/app\/portfolios$/);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('app pages fit the screen width (no sideways scrolling)', async ({ page }) => {
  for (const path of [
    '/app/dashboard',
    `/app/strategies/${SAMPLE_ID}`,
    '/app/regime',
    '/app/portfolios',
    '/app/portfolio-backtests/new',
    '/app/scoring',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
