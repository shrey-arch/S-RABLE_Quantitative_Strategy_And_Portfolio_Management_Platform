import { expect, test, type Page } from '@playwright/test';
import { backendIsUp } from './support/backend';

/**
 * Phase 2 journeys against the REAL FastAPI backend (via the Vite proxy).
 * Skipped automatically when the backend is not running on localhost:8000.
 *
 * Each run registers a new user named e2e-<time>@example.com in the database.
 * Clean up any time with:  DELETE FROM users WHERE email LIKE 'e2e-%@example.com';
 */

const BACKEND = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000';
const PASSWORD = 'E2e-test-pass-123';

/**
 * Register and log in wait on password hashing in the backend, which slows down
 * when many browser tests run at once. Allow 20 s for those steps (default 5 s).
 */
// A real server registering a user and checking a password, on a machine running
// the whole suite at once: 20 s was the frontend's patience, not the app's need.
const BACKEND_WAIT = { timeout: 45_000 };

test.beforeAll(async ({ request }) => {
  const up = await backendIsUp(request, BACKEND);
  test.skip(!up, `Backend not reachable at ${BACKEND}; start uvicorn to run these.`);
});

// Run once (desktop only): these tests create real users.
test.skip(({ isMobile }) => isMobile, 'Real-API journeys run on desktop only');

// Long journeys with many backend calls: allow up to 90 s each (default is 30 s).
test.describe.configure({ timeout: 90_000 });

/** Records every URL and console message, to prove no secret leaks into either. */
function watchForLeaks(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => seen.push(r.url()));
  page.on('framenavigated', (f) => seen.push(f.url()));
  page.on('console', (m) => seen.push(m.text()));
  return seen;
}

async function register(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Test User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/, BACKEND_WAIT);
  await expect(page.getByRole('status')).toContainText('Account created');
}

async function login(page: Page) {
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
}

const uniqueEmail = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test('register -> login -> protected page -> logout', async ({ page }) => {
  const seen = watchForLeaks(page);
  const email = uniqueEmail();

  // A protected page sends visitors to Log in; from there they can create an account.
  await page.goto('/app/strategies');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Create an account' }).click();

  await register(page, email);
  await expect(page.getByLabel('Email')).toHaveValue(email);

  // Wrong password first: generic message only.
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid email or password.');

  await login(page);
  await expect(page).toHaveURL(/\/app\/dashboard$/, BACKEND_WAIT);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account menu' })).toContainText('E2E Test User');

  // Session survives a refresh (sessionStorage).
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // Logout ends the session; protected pages are closed again.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/app/brokers');
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('srable.session'))).toBeNull();

  // Registering the same email again is refused.
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Again');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/already exists\. Log in instead/)).toBeVisible();

  // No password or token in any URL or console message.
  const token = 'eyJ';
  for (const entry of seen) {
    expect(entry).not.toContain(PASSWORD);
    expect(entry).not.toContain(token);
  }
});

test('an expired session redirects to login once, without a loop', async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await login(page);
  await expect(page).toHaveURL(/\/app\/dashboard$/, BACKEND_WAIT);

  // Replace the token with one the backend rejects (bad signature, not yet expired).
  await page.evaluate(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 600;
    sessionStorage.setItem(
      'srable.session',
      `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x', exp })}.invalid-signature`,
    );
  });

  let meCalls = 0;
  let loginLoads = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/users/me')) meCalls += 1;
  });
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame() && f.url().endsWith('/login')) loginLoads += 1;
  });

  await page.goto('/app/portfolios');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Your session has ended');

  // Wait to make sure nothing keeps retrying or redirecting.
  await page.waitForTimeout(2000);
  expect(meCalls).toBe(1);
  expect(loginLoads).toBe(1);
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('srable.session'))).toBeNull();

  // Logging in again returns to the page that was asked for.
  await page.getByLabel('Email').fill(email);
  await login(page);
  await expect(page).toHaveURL(/\/app\/portfolios$/, BACKEND_WAIT);
});
