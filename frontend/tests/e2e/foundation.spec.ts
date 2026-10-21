import { expect, test } from '@playwright/test';
import { APP_ROUTES, PUBLIC_ROUTES } from '../../src/app/routes';

/** Phase 1 foundation checks, updated for Phase 2 route protection. No backend needed. */

const SAMPLE_ID = '00000000-0000-0000-0000-000000000001';
const toUrl = (path: string) => path.replace(':id', SAMPLE_ID);

test('every public route loads by direct URL', async ({ page }) => {
  for (const route of PUBLIC_ROUTES.filter((r) => r.path !== '/')) {
    await page.goto(toUrl(route.path));
    await expect(page.getByRole('heading', { level: 1, name: route.title })).toBeVisible();
  }
});

test('the landing page leads to register and login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

// One test per route: each gets its own time limit, and a failure names the route.
for (const route of APP_ROUTES) {
  test(`logged-out visitors to ${route.path} are sent to /login`, async ({ page }) => {
    await page.goto(toUrl(route.path));
    await expect(page).toHaveURL(/\/login$/);
  });
}

test('a page survives a browser refresh', async ({ page }) => {
  await page.goto('/register');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Create account' })).toBeVisible();
});

test('/app sends logged-out visitors to /login', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
});

test('unknown addresses show "Page not found"', async ({ page }) => {
  await page.goto('/this/does/not/exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('a crashing page shows the error screen, not a blank page', async ({ page }) => {
  await page.goto('/dev/crash');
  await expect(page.getByRole('alert')).toContainText('This page failed to load');
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
});

test('the chosen theme is remembered after reload', async ({ page }) => {
  await page.goto('/dev/components');
  const html = page.locator('html');
  const wasDark = await html.evaluate((el) => el.classList.contains('dark'));

  await page.getByRole('button', { name: /theme$/ }).click();
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/);

  await page.reload();
  await expect(html).toHaveClass(wasDark ? /^(?!.*dark)/ : /dark/);
});

test('pages fit the screen width (no sideways scrolling)', async ({ page }) => {
  for (const path of ['/', '/login', '/register', '/dev/shared', '/dev/table']) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});
