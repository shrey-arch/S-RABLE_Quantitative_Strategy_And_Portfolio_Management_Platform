import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { backendIsUp } from './support/backend';

/**
 * Phase 16 gate against the REAL backend: broker accounts are added, connected,
 * disconnected, edited and deleted from the website, their secrets are never sent
 * back, and a second user cannot see the first user's account; the profile shows
 * the last login and saves the editable fields. (Run notifications are checked in
 * backtests.real.spec.ts, which runs a real backtest.)
 *
 * Each run registers new users named e2e-<time>@example.com in the database.
 * Clean up any time with:  DELETE FROM users WHERE email LIKE 'e2e-%@example.com';
 */

const BACKEND = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000';
const PASSWORD = 'E2e-test-pass-123';
const BACKEND_WAIT = { timeout: 30_000 };

test.beforeAll(async ({ request }) => {
  const up = await backendIsUp(request, BACKEND);
  test.skip(!up, `Backend not reachable at ${BACKEND}; start uvicorn to run these.`);
});

test.skip(({ isMobile }) => isMobile, 'Real-API journeys run on desktop only');
test.describe.configure({ timeout: 120_000 });

const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function registerAndLogIn(page: Page, name = 'E2E Account') {
  const email = uniqueEmail();
  await page.goto('/register');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/, BACKEND_WAIT);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/, BACKEND_WAIT);
  const token = await page.evaluate(() => sessionStorage.getItem('srable.session'));
  return { email, headers: { Authorization: `Bearer ${token}` } };
}

/** A second user, straight through the API. */
async function otherUser(request: APIRequestContext) {
  const email = uniqueEmail();
  await request.post(`${BACKEND}/auth/register`, {
    data: { full_name: 'E2E Other', email, password: PASSWORD },
  });
  const login = await request.post(`${BACKEND}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  const { access_token } = (await login.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

test('broker accounts through the real API; secrets stay write-only; other users see none', async ({
  page,
}) => {
  const { headers } = await registerAndLogIn(page);
  const bodies: string[] = [];
  page.on('response', async (r) => {
    if (new URL(r.url()).pathname.startsWith('/brokers/'))
      bodies.push(await r.text().catch(() => ''));
  });
  const brokerUserId = `E2E${Date.now() % 1_000_000}`;
  await page.goto('/app/brokers');
  await expect(page.getByText('No broker accounts yet')).toBeVisible(BACKEND_WAIT);

  for (const attempt of ['first', 'duplicate']) {
    await page.getByRole('button', { name: /Add broker account/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Broker' }).selectOption('ZERODHA');
    await dialog.getByLabel(/Broker user ID/).fill(brokerUserId);
    await dialog.getByLabel(/Alias/).fill('Gate account');
    await dialog.getByLabel(/API key/).fill('gate-key-123');
    await dialog.getByLabel(/API secret/).fill('gate-secret-456');
    await dialog.getByRole('button', { name: 'Save account' }).click();
    if (attempt === 'first') await expect(page.getByRole('dialog')).toHaveCount(0, BACKEND_WAIT);
    else {
      await expect(dialog.getByRole('alert')).toHaveText(
        'This broker account is already connected to your account.',
        BACKEND_WAIT,
      );
      await page.keyboard.press('Escape');
    }
  }
  const card = page.getByRole('listitem', { name: 'Zerodha \u00b7 Gate account' });
  await expect(card).toContainText('DISCONNECTED');
  await expect(card).toContainText(brokerUserId);

  await card.getByRole('button', { name: /^Connect/ }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/Access token/)
    .fill('gate-token-789');
  await page
    .getByRole('dialog')
    .getByLabel(/Refresh token/)
    .fill('gate-refresh-000');
  await page.getByRole('dialog').getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, BACKEND_WAIT);
  await expect(card).toContainText('CONNECTED', BACKEND_WAIT);

  // The page shows exactly what the backend returns.
  const [stored] = (await (
    await page.request.get(`${BACKEND}/brokers/accounts`, { headers })
  ).json()) as { id: string; connection_status: string; is_active: boolean }[];
  expect(stored!.connection_status).toBe('CONNECTED');

  // A second user cannot list, open or change it.
  const other = await otherUser(page.request);
  expect(
    await (await page.request.get(`${BACKEND}/brokers/accounts`, { headers: other })).json(),
  ).toEqual([]);
  for (const r of [
    await page.request.get(`${BACKEND}/brokers/accounts/${stored!.id}`, { headers: other }),
    await page.request.post(`${BACKEND}/brokers/accounts/${stored!.id}/disconnect`, {
      headers: other,
    }),
    await page.request.delete(`${BACKEND}/brokers/accounts/${stored!.id}`, { headers: other }),
  ])
    expect(r.status()).toBe(404);

  await card.getByRole('button', { name: /Disconnect/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect' }).click();
  await expect(card).toContainText('DISCONNECTED', BACKEND_WAIT);

  await card.getByRole('button', { name: /Edit/ }).click();
  await page.getByRole('dialog').getByLabel(/Alias/).fill('');
  await page.getByRole('dialog').getByRole('switch', { name: 'Active' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  const renamed = page.getByRole('listitem', { name: `Zerodha \u00b7 ${brokerUserId}` });
  await expect(renamed).toContainText('Inactive', BACKEND_WAIT);
  await expect(renamed).toContainText('None');

  // No secret ever came back from the backend or reached the page.
  for (const secret of ['gate-key-123', 'gate-secret-456', 'gate-token-789', 'gate-refresh-000']) {
    expect(bodies.join(' ')).not.toContain(secret);
    expect(await page.content()).not.toContain(secret);
  }

  await renamed.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('No broker accounts yet')).toBeVisible(BACKEND_WAIT);
});

test('the profile shows the last login and saves the editable fields', async ({ page }) => {
  const { email, headers } = await registerAndLogIn(page, 'E2E Profile');
  await page.goto('/app/profile');
  const details = page.getByRole('region', { name: 'Account details' });
  await expect(details).toContainText(email, BACKEND_WAIT);
  await expect(details).toContainText('Active');
  await expect(details).not.toContainText('Never');

  const form = page.getByRole('form', { name: 'Edit profile' });
  await form.getByLabel(/Profile image URL/).fill('not a link');
  await form.getByRole('button', { name: 'Save profile' }).click();
  await expect(form.getByText('Must start with http:// or https://.')).toBeVisible();

  await form.getByLabel(/Profile image URL/).fill('');
  await form.getByLabel(/Full name/).fill('E2E Profile Saved');
  await form.getByLabel(/Phone number/).fill('+91 90000 00000');
  await form.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText(
    'E2E Profile Saved',
    BACKEND_WAIT,
  );
  const me = (await (await page.request.get(`${BACKEND}/users/me`, { headers })).json()) as {
    full_name: string;
    phone_number: string | null;
    email: string;
  };
  expect(me).toMatchObject({
    full_name: 'E2E Profile Saved',
    phone_number: '+91 90000 00000',
    email,
  });
  await page.reload();
  await expect(details).toContainText('+91 90000 00000', BACKEND_WAIT);
});
