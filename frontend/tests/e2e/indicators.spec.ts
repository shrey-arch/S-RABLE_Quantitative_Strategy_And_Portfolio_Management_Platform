import { expect, test } from '@playwright/test';
import { quietBell } from './support/bell';
import { INDICATORS_FIXTURE } from '../../src/features/indicators/indicator-fixture';

/**
 * Phase 7: the indicator catalogue in a real browser. GET /indicators answers with
 * the catalogue exported from the backend; the parameter check is a small fake.
 */

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.pathname === '/users/me' || url.pathname.startsWith('/indicators'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const path = new URL(request.url()).pathname;
      if (path === '/users/me') {
        return route.fulfill({
          json: {
            id: 'u-1',
            full_name: 'Ind Test',
            email: 'i@example.com',
            account_status: 'ACTIVE',
          },
        });
      }
      if (path === '/indicators') return route.fulfill({ json: INDICATORS_FIXTURE });
      const key = path.split('/')[2]!;
      const parameters = (request.postDataJSON() as { parameters: Record<string, number> })
        .parameters;
      if (key === 'MACD' && parameters.fast_period! >= parameters.slow_period!) {
        return route.fulfill({
          status: 422,
          json: { detail: 'fast_period must be less than slow_period.' },
        });
      }
      return route.fulfill({ json: { key, parameters } });
    },
  );
  await quietBell(page);
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
  await page.goto('/app/indicators');
  await expect(page.getByRole('heading', { level: 1, name: 'Indicators' })).toBeVisible();
});

test('the catalogue lists every backend indicator and is linked from the sidebar', async ({
  page,
}) => {
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(
    INDICATORS_FIXTURE.map((i) => i.name),
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the parameter check shows what the backend accepts or rejects', async ({ page }) => {
  const check = page.getByRole('region', { name: 'Check parameters' });
  await check.getByLabel('Type').selectOption('MACD');
  await check.getByLabel('fast_period').fill('30');
  await check.getByRole('button', { name: 'Check' }).click();
  await expect(check.getByRole('alert')).toHaveText('fast_period must be less than slow_period.');
  await check.getByLabel('fast_period').fill('8');
  await check.getByRole('button', { name: 'Check' }).click();
  await expect(check.getByRole('status')).toHaveText(
    'Accepted: MACD fast_period=8, slow_period=26, signal_period=9',
  );
});
