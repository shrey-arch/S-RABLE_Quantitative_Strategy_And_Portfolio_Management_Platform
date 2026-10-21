import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import type { MarketDataRow } from '../../src/features/instruments/market-data';
import {
  coverage,
  importResult,
  MARKET_DATA_FIXTURE,
} from '../../src/features/instruments/market-data-fixture';
import { INDICATORS_FIXTURE } from '../../src/features/indicators/indicator-fixture';
import type { Instrument } from '../../src/features/instruments/queries';

/**
 * Phase 6: the instrument catalogue in a real browser. An in-memory fake of the
 * instrument API answers fetch requests, so saved changes survive a reload.
 */

const USER = {
  id: 'u-1',
  full_name: 'Inst Test',
  email: 'i@example.com',
  account_status: 'ACTIVE',
};

async function openInstruments(page: Page, start: Instrument[], path = '/app/instruments') {
  const store = new Map(start.map((i) => [i.id, { ...i }]));
  let nextId = 1;

  await page.route(
    (url) =>
      url.pathname === '/users/me' ||
      url.pathname === '/indicators' ||
      url.pathname.startsWith('/instruments'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const path = new URL(request.url()).pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      // The detail page loads the indicator catalogue. Answered here so a running
      // backend never sees the stand-in token (its 401 would log the test out).
      if (path === '/indicators') return route.fulfill({ json: INDICATORS_FIXTURE });
      // Market data and delete are answered by the detail-page tests below.
      if (
        path.includes('/market-data') ||
        path.includes('/indicators') ||
        request.method() === 'DELETE'
      )
        return route.fallback();

      const duplicate = (symbol: string, except?: string) =>
        [...store.values()].some((i) => i.trading_symbol === symbol && i.id !== except);
      const conflict = () =>
        route.fulfill({
          status: 409,
          json: { detail: 'An instrument with this trading symbol already exists.' },
        });

      if (path === '/instruments') {
        if (request.method() === 'POST') {
          const body = request.postDataJSON() as Instrument;
          if (duplicate(body.trading_symbol)) return conflict();
          const created = {
            ...body,
            id: `00000000-0000-4000-8000-00000000000${nextId++}`,
            created_at: '2026-10-16T09:00:00Z',
            updated_at: '2026-10-16T09:00:00Z',
          };
          store.set(created.id, created);
          return route.fulfill({ status: 201, json: created });
        }
        return route.fulfill({ json: [...store.values()] });
      }

      const item = store.get(path.split('/')[2] ?? '');
      if (!item) return route.fulfill({ status: 404, json: { detail: 'Instrument not found.' } });
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as Partial<Instrument>;
        if (body.trading_symbol && duplicate(body.trading_symbol, item.id)) return conflict();
        Object.assign(item, body);
      }
      return route.fulfill({ json: item });
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
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: path.includes('/app/instruments/') ? RELIANCE.symbol : 'Instruments',
    }),
  ).toBeVisible();
}

const openInstrument = (page: Page, path = DETAIL) =>
  openInstruments(page, INSTRUMENTS_FIXTURE, path);

const table = (page: Page) => page.getByRole('table', { name: 'Instruments' });

test('lists instruments and filters them; filters stay in the address', async ({ page }) => {
  await openInstruments(page, INSTRUMENTS_FIXTURE);
  await expect(table(page).getByRole('row')).toHaveCount(4); // header + 3
  await page.getByRole('combobox', { name: 'Exchange' }).selectOption('MCX');
  await expect(table(page).getByRole('row')).toHaveCount(2);
  await expect(page).toHaveURL(/exchange=MCX/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Exchange' })).toHaveValue('MCX');
  await expect(table(page)).toContainText('GOLDM');

  // Nothing spills sideways on phones; the wide table scrolls inside its box.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('adding an instrument saves it; a duplicate trading symbol is refused', async ({ page }) => {
  await openInstruments(page, [INSTRUMENTS_FIXTURE[0]!]);
  await page.getByRole('button', { name: 'Add instrument' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Symbol/).fill('TCS');
  await dialog.getByLabel(/^Trading symbol/).fill('TCS-EQ');
  await dialog.getByLabel(/^Name/).fill('Tata Consultancy Services');
  const saved = page.waitForResponse((r) => r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Add instrument' }).click();
  expect((await saved).status()).toBe(201);
  await expect(dialog).toBeHidden();
  await expect(table(page)).toContainText('TCS-EQ');

  await page.reload();
  await expect(table(page)).toContainText('TCS-EQ');

  await page.getByRole('button', { name: 'Add instrument' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Symbol/).fill('RELIANCE');
  await dialog.getByLabel(/^Trading symbol/).fill('RELIANCE-EQ');
  await dialog.getByLabel(/^Name/).fill('Duplicate');
  await dialog.getByRole('button', { name: 'Add instrument' }).click();
  await expect(
    dialog.getByText('An instrument with this trading symbol already exists.'),
  ).toBeVisible();
  await expect(dialog.getByLabel(/^Trading symbol/)).toHaveAttribute('aria-invalid', 'true');
});

test('deactivating is saved and survives a reload', async ({ page }) => {
  await openInstruments(page, [INSTRUMENTS_FIXTURE[0]!]);
  const toggle = page.getByRole('switch', { name: 'Active: RELIANCE' });
  await expect(toggle).toBeChecked();
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await toggle.click();
  expect((await saved).request().postDataJSON()).toEqual({ is_active: false });
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Active: RELIANCE' })).not.toBeChecked();
});

// ---- Detail page: stored daily data, coverage, quality and import -------------------

const RELIANCE = INSTRUMENTS_FIXTURE[0]!;
const DETAIL = `/app/instruments/${RELIANCE.id}`;

/** Answers the market-data routes from a store; an import adds the bars it "downloaded". */
async function fakeMarketData(page: Page, start: MarketDataRow[]) {
  const rows = [...start];
  const day = (r: MarketDataRow) => r.timestamp.slice(0, 10);
  const between = (q: URLSearchParams) =>
    rows.filter(
      (r) =>
        (!q.get('start_date') || day(r) >= q.get('start_date')!) &&
        (!q.get('end_date') || day(r) <= q.get('end_date')!),
    );
  await page.route(
    (url) => url.pathname.startsWith(`/instruments/${RELIANCE.id}/market-data`),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      if (url.pathname.endsWith('/import')) {
        const body = request.postDataJSON() as { start_date: string; end_date: string };
        const added = ['2026-10-13', '2026-10-14', '2026-10-15'].map((d, i) => ({
          timestamp: `${d}T00:00:00Z`,
          open: 1385 + i,
          high: 1395 + i,
          low: 1375 + i,
          close: 1390 + i,
          volume: 5_000_000,
        }));
        rows.push(...added);
        return route.fulfill({
          json: importResult({ ...body, fetched: 3, inserted: 3, skipped_existing: 0 }),
        });
      }
      const inRange = between(url.searchParams);
      if (url.pathname.endsWith('/coverage')) {
        return route.fulfill({
          json: coverage({
            row_count: inRange.length,
            first_timestamp: inRange[0]?.timestamp ?? null,
            last_timestamp: inRange.at(-1)?.timestamp ?? null,
          }),
        });
      }
      return route.fulfill({ json: inRange });
    },
  );
}

const chart = (page: Page) => page.getByRole('img', { name: /daily .* chart with volume/ });

test('detail page draws the stored daily bars with coverage and quality', async ({ page }) => {
  await fakeMarketData(page, MARKET_DATA_FIXTURE);
  await openInstrument(page);
  await expect(
    page.getByText('Historical \u00b7 daily \u00b7 source: Yahoo Finance'),
  ).toBeVisible();
  await expect(chart(page)).toHaveAttribute('data-bar-count', String(MARKET_DATA_FIXTURE.length));
  await expect(chart(page).locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('list', { name: 'Data quality warnings' })).toContainText(
    '1 day with zero volume.',
  );
  await expect(page.getByText('Trading days missing')).toBeVisible();

  // A sampled range: the chart has exactly the rows the API returned for it.
  const answered = page.waitForResponse(
    (r) => r.url().includes('/market-data?') && r.url().includes('start_date=2026-10-06'),
  );
  await page.getByLabel('From', { exact: true }).fill('2026-10-06');
  const rows = (await (await answered).json()) as MarketDataRow[];
  await expect(chart(page)).toHaveAttribute('data-bar-count', String(rows.length));
  await expect(page).toHaveURL(/from=2026-10-06/);
  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-bar-count', String(rows.length));

  // Line mode draws the same bars.
  await page.getByRole('button', { name: 'Line' }).click();
  await expect(chart(page)).toHaveAccessibleName(/close price chart/);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a range without data shows a message, not an empty chart', async ({ page }) => {
  await fakeMarketData(page, MARKET_DATA_FIXTURE);
  await openInstrument(page, `${DETAIL}?from=2026-09-01&to=2026-09-30`);
  await expect(page.getByText('No data for this range')).toBeVisible();
  await expect(chart(page)).toHaveCount(0);
});

test('importing stores new bars and the chart reloads', async ({ page }) => {
  await fakeMarketData(page, MARKET_DATA_FIXTURE);
  await openInstrument(page);
  await expect(chart(page)).toHaveAttribute('data-bar-count', '6');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status')).toContainText('fetched 3, stored 3');
  await expect(chart(page)).toHaveAttribute('data-bar-count', '9');
});

test('delete is refused with the backend message when data is stored', async ({ page }) => {
  await fakeMarketData(page, MARKET_DATA_FIXTURE);
  await page.route(
    (url) => url.pathname === `/instruments/${RELIANCE.id}`,
    (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({
            status: 409,
            json: {
              detail:
                'This instrument has stored price data or trading records, so it cannot be deleted. Deactivate it instead.',
            },
          })
        : route.fallback(),
  );
  await openInstrument(page);
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete instrument' }).click();
  await expect(page.getByText(/so it cannot be deleted\. Deactivate it instead\./)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${DETAIL}$`));
});

/** GET /indicators, the parameter check, and series = close price shifted by the window. */
async function fakeIndicators(page: Page, rows: MarketDataRow[]) {
  await page.route(
    (url) => url.pathname.startsWith('/indicators') || url.pathname.includes('/indicators/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const path = new URL(request.url()).pathname;
      if (path === '/indicators') return route.fulfill({ json: INDICATORS_FIXTURE });
      const body = request.postDataJSON() as {
        parameters: Record<string, number>;
        start_date?: string;
        end_date?: string;
      };
      const key =
        path.split('/').filter(Boolean).at(-1) === 'validate'
          ? path.split('/')[2]!
          : path.split('/').at(-1)!;
      if (path.endsWith('/validate'))
        return route.fulfill({ json: { key, parameters: body.parameters } });
      const inRange = rows.filter(
        (r) =>
          (!body.start_date || r.timestamp.slice(0, 10) >= body.start_date) &&
          (!body.end_date || r.timestamp.slice(0, 10) <= body.end_date),
      );
      return route.fulfill({
        json: {
          instrument_id: RELIANCE.id,
          key,
          panel: key === 'RSI' ? 'separate' : 'price',
          parameters: body.parameters,
          outputs: ['value'],
          points: inRange.map((r, i) => ({
            timestamp: r.timestamp,
            values: { value: i === 0 ? null : key === 'RSI' ? 50 : r.close },
          })),
        },
      });
    },
  );
}

test('indicators from the backend are drawn on the chart and kept in the address', async ({
  page,
}) => {
  await fakeMarketData(page, MARKET_DATA_FIXTURE);
  await fakeIndicators(page, MARKET_DATA_FIXTURE);
  await openInstrument(page);
  const before = (await chart(page).boundingBox())!.height;

  await page.getByRole('button', { name: 'Add indicator' }).click();
  await page.getByLabel(/^window/).fill('3');
  await page.getByRole('button', { name: 'Add to chart' }).click();
  await expect(chart(page)).toHaveAttribute('data-overlay-count', '1');
  await expect(page).toHaveURL(/ind=SMA%3Awindow%3D3/);

  await page.getByRole('button', { name: 'Add indicator' }).click();
  await page.getByLabel('Type', { exact: true }).selectOption('RSI');
  await page.getByRole('button', { name: 'Add to chart' }).click();
  await expect(chart(page)).toHaveAttribute('data-overlay-count', '2');
  await expect(chart(page)).toHaveAccessibleName(/with SMA\(3\), RSI\(14\)/);
  // RSI gets its own pane, so the chart grows.
  expect((await chart(page).boundingBox())!.height).toBeGreaterThan(before);

  await page.reload();
  await expect(chart(page)).toHaveAttribute('data-overlay-count', '2');
  await page.getByRole('button', { name: 'Remove SMA(3)' }).click();
  await expect(chart(page)).toHaveAttribute('data-overlay-count', '1');
});
