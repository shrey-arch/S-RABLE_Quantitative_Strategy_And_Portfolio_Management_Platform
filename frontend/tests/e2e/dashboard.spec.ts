import { expect, test, type Page, type Route } from '@playwright/test';
import { quietBell } from './support/bell';
import { LIVE_SESSIONS } from '../../src/features/live/live-fixture';
import { VS_VALIDATIONS } from '../../src/features/validation/validation-status-fixture';
import { formatINR } from '../../src/lib/format';
import { API_PREFIXES } from '../../src/api/api-prefixes';

/**
 * Phase 4: the dashboard in a real browser. No backend needed: the test logs in with a
 * stand-in token and answers every API call itself (page.route).
 */

const USER = {
  id: 'u-1',
  full_name: 'Dash Test',
  email: 'dash@example.com',
  account_status: 'ACTIVE',
};

type Handler = (route: Route) => Promise<void>;
const json =
  (body: unknown, status = 200): Handler =>
  (route) =>
    route.fulfill({ status, json: body });

/** Answers only fetch requests to `pathname`, never page loads. */
async function api(page: Page, pathname: string, handler: Handler) {
  await page.route(
    (url) => url.pathname === pathname,
    (route) => (route.request().resourceType() === 'fetch' ? handler(route) : route.continue()),
  );
}

/**
 * Answers every other API call with 404, so a call this file did not think of
 * cannot reach a real backend.
 *
 * It matters because of the stand-in token: a real backend answers 401, the app
 * treats that as the session ending and sends the browser to /login, and a test
 * fails for a reason that is not a fault. That is what happened when this file's
 * live-sessions card opened a session page - the card's own call was answered
 * here, the page's four calls were not. Which side won was a race, so it passed
 * on an idle machine and failed on a busy one. 404 is the honest stand-in: the
 * page shows "not available" and stays where it is.
 */
async function apiOtherwiseMissing(page: Page) {
  await page.route(
    (url) => API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)),
    (route) =>
      route.request().resourceType() === 'fetch'
        ? route.fulfill({ status: 404, json: { detail: 'Not found (no stand-in for this call).' } })
        : route.continue(),
  );
}

async function openDashboard(page: Page, overrides: Record<string, Handler> = {}) {
  // First, so the handlers added after it win (Playwright tries the newest route first).
  await apiOtherwiseMissing(page);
  const handlers: Record<string, Handler> = {
    '/users/me': json(USER),
    '/strategies': json([
      { id: 's1', is_active: true },
      { id: 's2', is_active: false },
    ]),
    '/brokers/accounts': json([{ id: 'b1', connection_status: 'CONNECTED' }]),
    '/instruments': json([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }]),
    '/portfolio/accounts': json([{ id: 'p1' }]),
    '/portfolio/accounts/p1': json({ total_equity: '150000.00' }),
    // No regime model trained (the regime widget is tested in regime.spec.ts).
    '/regime/current': json({ detail: 'No regime model has been trained yet.' }, 404),
    // Nothing scored yet (the top strategies widget is tested in scoring.spec.ts).
    '/scoring': json({ regime: null, weights: {}, custom_weights: false, rows: [] }),
    // Feature 5: the latest validation verdicts, as GET /validations returned them.
    '/validations': json(VS_VALIDATIONS),
    // Feature 7: live paper sessions, as GET /live/sessions returned them.
    '/live/sessions': json(LIVE_SESSIONS),
    ...overrides,
  };
  for (const [path, handler] of Object.entries(handlers)) await api(page, path, handler);
  await quietBell(page);
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('shows the numbers from each endpoint', async ({ page }) => {
  await openDashboard(page);
  await expect(card(page, 'Strategies')).toContainText('1active of 2 strategies');
  await expect(card(page, 'Portfolios')).toContainText('1,50,000.00');
  await expect(card(page, 'Broker accounts')).toContainText('1connected of 1 account');
  await expect(card(page, 'Instruments')).toContainText('3active instruments available');
});

test('one failing widget leaves the others usable, and retry recovers it', async ({ page }) => {
  let brokersUp = false;
  await openDashboard(page, {
    '/brokers/accounts': (route) =>
      brokersUp
        ? route.fulfill({ json: [{ id: 'b1', connection_status: 'CONNECTED' }] })
        : route.fulfill({ status: 500, json: { detail: 'down' } }),
  });

  const brokers = card(page, 'Broker accounts');
  // Server errors are retried twice before the error shows (about 3 s).
  await expect(brokers.getByRole('alert')).toContainText("Couldn't load", { timeout: 15_000 });

  // The other widgets and links keep working.
  await expect(card(page, 'Strategies')).toContainText('active of 2 strategies');
  await expect(card(page, 'Instruments')).toContainText('3');
  await expect(card(page, 'Portfolios')).toContainText('1,50,000.00');
  await expect(card(page, 'Strategies').getByRole('alert')).toHaveCount(0);

  // Retry reloads just this widget.
  brokersUp = true;
  await brokers.getByRole('button', { name: /Try again/ }).click();
  await expect(brokers).toContainText('1connected of 1 account');
});

test('a whole failing list does not blank the page', async ({ page }) => {
  await openDashboard(page, {
    '/strategies': json({ detail: 'nope' }, 403),
    '/portfolio/accounts': json({ detail: 'nope' }, 422),
  });
  // 4xx errors are not retried, so they show at once.
  await expect(card(page, 'Strategies').getByRole('alert')).toBeVisible();
  await expect(card(page, 'Portfolios').getByRole('alert')).toBeVisible();
  await expect(card(page, 'Instruments')).toContainText('3');
  await expect(page.getByRole('region', { name: 'Next steps' })).toBeVisible();
});

test('next steps link to the right pages', async ({ page }) => {
  await openDashboard(page, { '/strategies': json([]) });
  const steps = page.getByRole('region', { name: 'Next steps' });
  await steps.getByRole('link', { name: 'Create a strategy' }).click();
  await expect(page).toHaveURL(/\/app\/builder\/new$/);
});

test('the latest validation verdicts widget lists the API verdicts and opens a report', async ({
  page,
}) => {
  await openDashboard(page);
  const widget = card(page, 'Latest validation verdicts');
  const items = widget.getByRole('listitem');
  await expect(items).toHaveCount(VS_VALIDATIONS.length);
  for (const [i, v] of VS_VALIDATIONS.entries()) {
    await expect(items.nth(i)).toContainText(v.strategy_name!);
    // The verdict, with the backend's reason as its tooltip.
    await expect(items.nth(i).locator(`[title="${v.verdict.reason}"]`)).toHaveCount(1);
  }
  await expect(page.getByRole('region', { name: 'Coming later' })).toHaveCount(0);
  await expect(items.first().getByRole('link')).toHaveAttribute(
    'href',
    `/app/validation/${VS_VALIDATIONS[0]!.id}`,
  );
});

test('the live sessions card lists the sessions, running first, with their net P&L', async ({
  page,
}) => {
  await openDashboard(page);
  const live = card(page, 'Live sessions');
  await expect(live).toContainText('1 running now.');
  await expect(live).toContainText('Virtual money \u00b7 simulated orders');
  const items = live.getByRole('list', { name: 'Live sessions' }).getByRole('listitem');
  await expect(items).toHaveCount(LIVE_SESSIONS.length);
  const running = LIVE_SESSIONS.find((s) => s.status === 'RUNNING')!;
  await expect(items.first()).toContainText(running.name);
  await expect(items.first()).toContainText(formatINR(running.money.net_pnl));
  await items.first().getByRole('link', { name: running.name }).click();
  await expect(page).toHaveURL(new RegExp(`/app/live/sessions/${running.id}$`));
});
