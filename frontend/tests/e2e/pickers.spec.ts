import { expect, test } from '@playwright/test';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import { coverage } from '../../src/features/instruments/market-data-fixture';

/**
 * Phase 6.4: the instrument picker and the data-aware date range in a real browser
 * (dev page /dev/pickers). Instruments and coverage come from a fake API.
 */

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;

test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.pathname.startsWith('/instruments'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      if (url.pathname === '/instruments') return route.fulfill({ json: INSTRUMENTS_FIXTURE });
      const start = url.searchParams.get('start_date');
      if (!start) {
        return route.fulfill({
          json: coverage({
            first_timestamp: '2026-01-05T00:00:00Z',
            last_timestamp: '2026-10-12T00:00:00Z',
          }),
        });
      }
      if (start.startsWith('2026-09')) {
        return route.fulfill({
          json: coverage({ row_count: 0, first_timestamp: null, last_timestamp: null }),
        });
      }
      return route.fulfill({
        json: coverage({
          row_count: 6,
          first_timestamp: '2026-10-05T00:00:00Z',
          last_timestamp: '2026-10-12T00:00:00Z',
        }),
      });
    },
  );
  await page.goto('/dev/pickers');
});

test('the picker passes the UUID and the range is checked against stored data', async ({
  page,
}) => {
  const use = page.getByRole('button', { name: 'Use this data' });
  await page.getByLabel('Instrument').selectOption({ label: 'RELIANCE - Reliance Industries' });
  await expect(page.getByTestId('picked-id')).toHaveText(RELIANCE.id);
  await expect(page.getByText('Stored daily data: 05 Jan 2026 to 12 Oct 2026.')).toBeVisible();
  await expect(use).toBeDisabled();

  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-09-30');
  await expect(
    page.getByText('No stored bars fall in this range. Choose other dates.'),
  ).toBeVisible();
  await expect(use).toBeDisabled();

  await page.getByLabel('From', { exact: true }).fill('2026-10-03');
  await page.getByLabel('To', { exact: true }).fill('2026-10-12');
  await expect(page.getByText('6 daily bars, 05 Oct 2026 to 12 Oct 2026.')).toBeVisible();
  await expect(use).toBeEnabled();
});
