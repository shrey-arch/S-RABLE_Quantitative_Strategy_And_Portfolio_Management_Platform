import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { PORTFOLIO_ACCOUNT_SAVED } from '../../src/features/portfolios/portfolio-fixture';
import { REGISTRY_FIXTURE } from '../../src/features/strategies/registry-fixture';
import { VALIDATION_STATUS_LABELS } from '../../src/features/validation/validation-status';
import {
  VS_SCORES,
  VS_STRATEGIES,
  VS_TARGET_OFF,
  VS_TARGET_ON,
  VS_VALIDATIONS,
} from '../../src/features/validation/validation-status-fixture';

/**
 * Feature 5: only validated strategies get capital. A fake of the API answers with
 * what the backend returned for one strategy in each validation status.
 */

const USER = {
  id: 'u-1',
  full_name: 'Val Status',
  email: 'vs@example.com',
  account_status: 'ACTIVE',
};
const PID = PORTFOLIO_ACCOUNT_SAVED.id;

async function open(page: Page, path: string) {
  const fake = { targets: [] as { require_validated?: boolean }[] };
  await page.route(
    (url) =>
      ['/users/me', '/scoring', '/regime/current', '/strategy-registry', '/validations'].includes(
        url.pathname,
      ) ||
      url.pathname.startsWith('/strategies') ||
      url.pathname.startsWith('/portfolio/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const p = new URL(request.url()).pathname;
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/strategy-registry') return route.fulfill({ json: REGISTRY_FIXTURE });
      if (p === '/strategies') return route.fulfill({ json: VS_STRATEGIES });
      if (p.startsWith('/strategies/')) {
        const s = VS_STRATEGIES.find((x) => p === `/strategies/${x.id}`);
        return s
          ? route.fulfill({ json: s })
          : route.fulfill({ status: 404, json: { detail: 'Strategy not found.' } });
      }
      if (p === '/scoring') return route.fulfill({ json: VS_SCORES });
      if (p === '/validations') return route.fulfill({ json: VS_VALIDATIONS });
      if (p === '/regime/current')
        return route.fulfill({
          status: 404,
          json: { detail: 'No regime model has been trained yet.' },
        });
      if (p === '/portfolio/target') {
        const body = request.postDataJSON() as { require_validated?: boolean };
        fake.targets.push(body);
        return route.fulfill({
          json: body.require_validated === false ? VS_TARGET_OFF : VS_TARGET_ON,
        });
      }
      if (p === `/portfolio/accounts/${PID}`)
        return route.fulfill({ json: PORTFOLIO_ACCOUNT_SAVED });
      if (p === '/portfolio/prices') return route.fulfill({ json: [] });
      return route.fulfill({ status: 404, json: { detail: 'Not found.' } });
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

test('each strategy shows its validation status, and Validate it opens the form', async ({
  page,
}) => {
  await open(page, '/app/strategies');
  const table = page.getByRole('table', { name: 'My strategies' });
  for (const s of VS_STRATEGIES)
    await expect(table.getByRole('row', { name: new RegExp(s.name) })).toContainText(
      VALIDATION_STATUS_LABELS[s.validation.status],
    );
  const outdated = VS_STRATEGIES.find((s) => s.validation.status === 'OUTDATED')!;
  await page.goto(`/app/strategies/${outdated.id}`);
  const status = page.getByLabel('Validation status');
  await expect(status).toContainText(outdated.validation.reason);
  await status.getByRole('link', { name: 'Validate it' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/validation/new\\?strategy=${outdated.id}$`));
});

test('the target allocates only validated strategies unless the switch is on', async ({ page }) => {
  const fake = await open(page, `/app/portfolios/${PID}?tab=target`);
  const candidates = page.getByRole('list', { name: 'Candidate strategies' });
  for (const s of VS_STRATEGIES)
    await expect(candidates.getByRole('listitem').filter({ hasText: s.name })).toContainText(
      VALIDATION_STATUS_LABELS[s.validation.status],
    );
  const toggle = page.getByRole('switch', { name: 'Include unvalidated strategies' });
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: 'Calculate target' }).click();
  const notAllocated = page.getByRole('list', { name: 'Not allocated' });
  await expect(notAllocated.getByRole('listitem')).toHaveCount(VS_TARGET_ON.excluded.length);
  for (const e of VS_TARGET_ON.excluded)
    await expect(notAllocated.getByRole('listitem').filter({ hasText: e.name })).toContainText(
      e.reason,
    );
  expect(fake.targets.at(-1)!.require_validated).toBe(true);

  await toggle.click();
  await expect(page.getByText(/For experiments only/)).toBeVisible();
  await page.getByRole('button', { name: 'Calculate target' }).click();
  await expect(page.getByRole('note', { name: 'Unvalidated strategies included' })).toBeVisible();
  await expect(
    page.getByRole('table', { name: 'Selected strategies' }).getByRole('row'),
  ).toHaveCount(VS_TARGET_OFF.positions.length + 3);
  expect(fake.targets.at(-1)!.require_validated).toBe(false);
});
