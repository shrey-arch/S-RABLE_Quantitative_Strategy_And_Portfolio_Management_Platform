import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INDICATORS_FIXTURE } from '../../src/features/indicators/indicator-fixture';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import { SEEDED_NO_TRADES, SEEDED_TRADES } from '../../src/features/results/results-fixture';
import type { ExecutionResults } from '../../src/features/results/results-model';

/**
 * Phase 10: the results page in a real browser. A fake of the API answers every
 * request: the two seeded results (exactly as the backend returns them) and a
 * generated ten-year daily run (2,600 bars, 300 trades) to check the charts stay fast.
 */

const USER = { id: 'u-1', full_name: 'Res Test', email: 'r@example.com', account_status: 'ACTIVE' };
const RELIANCE = INSTRUMENTS_FIXTURE[0]!;
const LONG_ID = 'e0000000-0000-4000-8000-00000000000a';
const BROKEN_ID = 'e0000000-0000-4000-8000-00000000000b';

/** 2,600 weekdays from 2015 (about ten years of daily bars). */
const DAYS = (() => {
  const out: string[] = [];
  const d = new Date(Date.UTC(2015, 0, 1));
  while (out.length < 2600) {
    if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
})();
const ts = (day: string) => `${day}T00:00:00+00:00`;
const CLOSES = DAYS.map((_, i) => 400 * (1 + i / 4000 + 0.15 * Math.sin(i / 60)));

/** A fake ten-year result (the numbers only need to be plausible; the backend computes real ones). */
function longResults(): ExecutionResults {
  let peak = 0;
  const equity = DAYS.map((day, i) => {
    const value = 100_000 * (1 + i / 5000 + 0.08 * Math.sin(i / 45));
    peak = Math.max(peak, value);
    return { timestamp: ts(day), portfolio_value: value, drawdown: value / peak - 1 };
  });
  const months = new Map<string, number>();
  for (const p of equity) months.set(p.timestamp.slice(0, 7), p.portfolio_value);
  let previous = 100_000;
  const monthly = [...months].map(([month, value]) => {
    const row = { month, value: value / previous - 1 };
    previous = value;
    return row;
  });
  const fills = Array.from({ length: 600 }, (_, i) => {
    const bar = 4 + i * 4;
    return {
      timestamp: ts(DAYS[bar]!),
      instrument_id: RELIANCE.id,
      side: i % 2 === 0 ? 'BUY' : 'SELL',
      quantity: 10,
      price: CLOSES[bar]!,
      brokerage: 1.2,
      total_charges: 1.2,
      realized_pnl: i % 2 === 0 ? 0 : (CLOSES[bar]! - CLOSES[bar - 4]!) * 10,
      closed_quantity: i % 2 === 0 ? 0 : 10,
      opened_quantity: i % 2 === 0 ? 10 : 0,
    };
  });
  const trips = Array.from({ length: 300 }, (_, i) => {
    const entry = fills[2 * i]!;
    const exit = fills[2 * i + 1]!;
    const gross = (exit.price - entry.price) * 10;
    return {
      instrument_id: RELIANCE.id,
      direction: 'LONG',
      quantity: 10,
      entry_timestamp: entry.timestamp,
      entry_price: entry.price,
      exit_timestamp: exit.timestamp,
      exit_price: exit.price,
      gross_pnl: gross,
      charges: 2.4,
      net_pnl: gross - 2.4,
      return: (gross - 2.4) / (entry.price * 10),
      is_open: false,
    };
  });
  const last = equity[equity.length - 1]!;
  return {
    ...SEEDED_TRADES,
    execution_id: LONG_ID,
    summary: {
      ...SEEDED_TRADES.summary,
      initial_capital: 100_000,
      final_capital: last.portfolio_value,
      net_profit: last.portfolio_value - 100_000,
      total_return: last.portfolio_value / 100_000 - 1,
      bar_count: DAYS.length,
      first_bar_at: equity[0]!.timestamp,
      last_bar_at: last.timestamp,
    },
    equity_curve: equity,
    benchmark: {
      kind: 'buy_and_hold',
      instrument_id: RELIANCE.id,
      equity_curve: DAYS.map((day, i) => ({
        timestamp: ts(day),
        portfolio_value: (100_000 * CLOSES[i]!) / CLOSES[0]!,
      })),
      total_return: CLOSES[CLOSES.length - 1]! / CLOSES[0]! - 1,
    },
    monthly_returns: monthly,
    round_trips: trips,
    records: {
      orders: fills.map((f) => ({
        timestamp: f.timestamp,
        instrument_id: f.instrument_id,
        side: f.side,
        order_type: 'MARKET',
        quantity: f.quantity,
        status: 'FILLED',
        reference_price: f.price,
        fill_price: f.price,
      })),
      fills,
      positions: [],
      ending_cash: last.portfolio_value,
    },
    configuration: { ...SEEDED_TRADES.configuration, initial_capital: 100_000 },
  };
}

const RESULTS: Record<string, ExecutionResults> = {
  [SEEDED_TRADES.execution_id]: SEEDED_TRADES,
  [SEEDED_NO_TRADES.execution_id]: SEEDED_NO_TRADES,
  [LONG_ID]: longResults(),
};

const execution = (id: string) => ({
  id,
  strategy_id: SEEDED_TRADES.configuration.strategy_id,
  broker_account_id: null,
  instrument_id: RELIANCE.id,
  execution_type: 'BACKTEST',
  status: 'COMPLETED',
  timeframe: '1D',
  initial_capital: 10000,
  execution_config: {},
  execution_metrics: null,
  run_settings: {},
  error_message: null,
  error: null,
  started_at: '2026-10-16T09:00:02Z',
  completed_at: '2026-10-16T09:00:09Z',
  created_at: '2026-10-16T09:00:00Z',
  updated_at: '2026-10-16T09:00:00Z',
});

/** Daily bars for a range: the seeded closes for 2025, the ten-year closes otherwise. */
function bars(start: string | null, end: string | null) {
  const seeded = SEEDED_TRADES.equity_curve.map((p, i) => ({
    timestamp: p.timestamp,
    close: [100, 110, 90, 120][i]!,
  }));
  const long = DAYS.map((day, i) => ({ timestamp: ts(day), close: CLOSES[i]! }));
  return (start?.startsWith('2025') ? seeded : long)
    .filter((r) => (!start || r.timestamp >= start) && (!end || r.timestamp.slice(0, 10) <= end))
    .map((r) => ({ ...r, open: r.close, high: r.close * 1.01, low: r.close * 0.99, volume: 1000 }));
}

async function open(page: Page, path: string) {
  const calls = { indicators: [] as { start_date?: string; end_date?: string }[] };
  await page.route(
    (url) =>
      [
        '/users/me',
        '/instruments',
        '/indicators',
        '/executions',
        '/strategies',
        '/strategy-registry',
      ].some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`)),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      if (path === '/instruments') return route.fulfill({ json: INSTRUMENTS_FIXTURE });
      if (path === '/indicators') return route.fulfill({ json: INDICATORS_FIXTURE });
      if (path === '/strategy-registry') return route.fulfill({ json: [] });
      if (path.startsWith('/strategies'))
        return route.fulfill({ status: 404, json: { detail: 'Strategy not found.' } });
      if (path.endsWith('/market-data'))
        return route.fulfill({
          json: bars(url.searchParams.get('start_date'), url.searchParams.get('end_date')),
        });
      if (path.endsWith('/validate')) {
        const body = request.postDataJSON() as { parameters: Record<string, number> };
        return route.fulfill({ json: { key: path.split('/')[2], parameters: body.parameters } });
      }
      if (path.includes('/indicators/')) {
        const body = request.postDataJSON() as {
          parameters: Record<string, number>;
          start_date?: string;
          end_date?: string;
        };
        calls.indicators.push(body);
        const rows = bars(body.start_date ?? null, body.end_date ?? null);
        return route.fulfill({
          json: {
            instrument_id: RELIANCE.id,
            key: path.split('/').at(-1),
            panel: 'price',
            parameters: body.parameters,
            outputs: ['value'],
            points: rows.map((r, i) => ({
              timestamp: r.timestamp,
              values: { value: i === 0 ? null : r.close },
            })),
          },
        });
      }
      // Phase 15: names for the records drawer, and whether this run's records are stored.
      if (path === '/executions') return route.fulfill({ json: [] });
      if (path.endsWith('/records'))
        return route.fulfill({
          json: {
            execution_id: path.split('/')[2],
            stored: false,
            orders: 0,
            trades: 0,
            positions: 0,
          },
        });
      const match = /^\/executions\/([^/]+)(\/results)?$/.exec(path);
      const id = match?.[1] ?? '';
      if (id === BROKEN_ID)
        return match?.[2]
          ? route.fulfill({ status: 500, json: { detail: 'Database unavailable.' } })
          : route.fulfill({ json: execution(id) });
      const results = RESULTS[id];
      if (!results) return route.fulfill({ status: 404, json: { detail: 'Execution not found.' } });
      return route.fulfill({ json: match?.[2] ? results : execution(id) });
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
  return calls;
}

const resultsPath = (id: string, tab?: string) =>
  `/app/executions/${id}/results${tab ? `?tab=${tab}` : ''}`;
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('all five tabs render from the API, survive a reload, and fit the screen', async ({
  page,
}) => {
  await open(page, resultsPath(SEEDED_TRADES.execution_id));
  await expect(page.getByRole('heading', { level: 1, name: 'Backtest results' })).toBeVisible();
  await expect(page.getByText('Historical simulation', { exact: true })).toBeVisible();
  const final = page.getByRole('group', { name: 'Final capital' });
  await expect(final).toContainText('9,599.16');
  expect(SEEDED_TRADES.summary.final_capital).toBe(
    SEEDED_TRADES.equity_curve[SEEDED_TRADES.equity_curve.length - 1]!.portfolio_value,
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  const checks: [string, RegExp | string][] = [
    ['Charts', /Equity curve/],
    ['Trades', 'Trade log'],
    ['Records', 'Simulated fills'],
    ['Configuration', 'Data provenance'],
  ];
  for (const [name, heading] of checks) {
    await tab(page, name).click();
    await expect(page.getByRole('tabpanel', { name })).toBeVisible();
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    expect(await overflow(page), `sideways scroll on ${name}`).toBeLessThanOrEqual(1);
  }
  await expect(page).toHaveURL(/\?tab=configuration$/);
  await expect(page.getByRole('region', { name: 'Data provenance' })).toContainText(
    SEEDED_TRADES.provenance.datasets[0]!.data_fingerprint!,
  );
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: 'Configuration' })).toBeVisible();

  await tab(page, 'Charts').click();
  const equity = page.getByRole('img', { name: /^Equity curve/ });
  await expect(equity).toHaveAttribute('data-last-value', '9599.16');
  await expect(equity).toHaveAttribute('data-benchmark-count', '4');
  const price = page.getByRole('img', { name: /RELIANCE daily close price chart/ });
  await expect(price).toHaveAttribute('data-marker-count', '2');
  await expect(price.locator('canvas').first()).toBeVisible();
});

test('ten years of daily data: charts draw quickly, with every point and marker', async ({
  page,
}) => {
  await open(page, resultsPath(LONG_ID));
  await expect(page.getByRole('heading', { name: 'Return and risk' })).toBeVisible();
  // Load the chart code once, then time the tab switch itself.
  await tab(page, 'Charts').click();
  await expect(page.getByRole('img', { name: /^Equity curve/ })).toBeVisible();
  await tab(page, 'Summary').click();

  const started = Date.now();
  await tab(page, 'Charts').click();
  const equity = page.getByRole('img', { name: /^Equity curve/ });
  const drawdown = page.getByRole('img', { name: /^Drawdown chart/ });
  const price = page.getByRole('img', { name: /RELIANCE daily close price chart/ });
  // Three 2,600-point charts, and on a phone viewport the last of them can take
  // well over the 10 s this suite allows a check by default - which showed up as
  // "element(s) not found" on mobile, not as a slow chart. Waiting longer here is
  // the honest fix: the ceiling below is what judges the speed, and these only
  // have to wait for the work to finish.
  const DRAWN = { timeout: 30_000 };
  await expect(equity.locator('canvas').first()).toBeVisible(DRAWN);
  await expect(drawdown.locator('canvas').first()).toBeVisible(DRAWN);
  await expect(price).toHaveAttribute('data-bar-count', '2600', DRAWN);
  await expect(price.locator('canvas').first()).toBeVisible(DRAWN);
  const took = Date.now() - started;
  test.info().annotations.push({ type: 'timing', description: `2,600-bar charts in ${took} ms` });
  // The point of this number is to catch a chart that redraws pathologically -
  // seconds per frame, or every point re-laid out - not to measure this machine.
  // The assertions above are what prove nothing was downsampled. The ceiling is
  // generous because the whole suite runs in parallel against a real backend, and
  // a budget tuned on an idle machine fails on a busy one for no good reason; the
  // timing is recorded above either way, so a real regression is still visible.
  expect(took, `charts took ${took} ms`).toBeLessThan(10_000);

  await expect(equity).toHaveAttribute('data-total-points', '2600');
  await expect(equity).toHaveAttribute('data-point-count', '2600');
  await expect(price).toHaveAttribute('data-marker-count', '600');
  await expect(page.getByRole('table', { name: 'Monthly returns' }).getByRole('row')).toHaveCount(
    11,
  );

  // Scrolling the price chart stays responsive.
  const box = (await price.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  const wheel = Date.now();
  for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, -200);
  const scrolled = Date.now() - wheel;
  test
    .info()
    .annotations.push({ type: 'timing', description: `10 wheel events in ${scrolled} ms` });
  expect(scrolled, `scrolling took ${scrolled} ms`).toBeLessThan(6000);

  await tab(page, 'Trades').click();
  await expect(page.getByText(/1-20 of 300/)).toBeVisible();
});

test('Export CSV saves the displayed trade rows with the exact API values', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'downloads checked on desktop');
  await open(page, resultsPath(LONG_ID, 'trades'));
  const panel = page.getByRole('tabpanel', { name: 'Trades' });
  await panel.getByRole('textbox', { name: 'Search trades' }).fill('2015-0');
  const rows = await panel.getByRole('table', { name: 'Trade log' }).getByRole('row').count();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: /Export CSV/ }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('backtest-e0000000-trades.csv');
  const lines = readFileSync(await download.path(), 'utf8')
    .trim()
    .split('\r\n');
  expect(lines[0]).toBe(
    'trade,Instrument,direction,Quantity,entry_time,Entry price,exit_time,Exit price,Gross P&L,Charges,Net P&L,Return',
  );
  const first = RESULTS[LONG_ID]!.round_trips[0]!;
  expect(lines[1]).toBe(
    [
      1,
      'RELIANCE',
      'LONG',
      10,
      first.entry_timestamp,
      first.entry_price,
      first.exit_timestamp,
      first.exit_price,
      first.gross_pnl,
      first.charges,
      first.net_pnl,
      first.return,
    ].join(','),
  );
  // Every matching row, not only the page on screen (20 rows a page).
  const matching = RESULTS[LONG_ID]!.round_trips.filter(
    (t) => t.entry_timestamp.startsWith('2015-0') || t.exit_timestamp!.startsWith('2015-0'),
  ).length;
  expect(lines).toHaveLength(matching + 1);
  expect(matching).toBeGreaterThanOrEqual(rows - 1);
});

test('indicators on the results chart are computed by the backend for the run dates', async ({
  page,
}) => {
  const calls = await open(page, resultsPath(SEEDED_TRADES.execution_id, 'charts'));
  const price = page.getByRole('img', { name: /RELIANCE daily close price chart/ });
  await expect(price).toHaveAttribute('data-bar-count', '4');
  await page.getByRole('button', { name: 'Add indicator' }).click();
  await page.getByLabel(/^window/).fill('2');
  await page.getByRole('button', { name: 'Add to chart' }).click();
  await expect(price).toHaveAttribute('data-overlay-count', '1');
  await expect(price).toHaveAccessibleName(/and SMA\(2\)$/);
  expect(calls.indicators.at(-1)).toMatchObject({
    parameters: { window: 2 },
    start_date: '2025-01-06',
    end_date: '2025-01-09',
  });
  await expect(page).toHaveURL(/tab=charts&ind=SMA%3Awindow%3D2/);
});

test('no trades is a valid result; a failed load is an error with a retry', async ({ page }) => {
  await open(page, resultsPath(SEEDED_NO_TRADES.execution_id));
  await expect(page.getByRole('status').filter({ hasText: 'made no trades' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Sharpe ratio' })).toContainText(
    'Returns did not vary, so the ratio is not defined.',
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  await tab(page, 'Trades').click();
  await expect(page.getByText('No trades', { exact: true })).toBeVisible();

  await page.goto(resultsPath(BROKEN_ID));
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Something went wrong');
  await expect(alert.getByRole('button', { name: /Try again/ })).toBeVisible();
  await expect(page.getByText(/made no trades/)).toHaveCount(0);
});

test('the run page links to its results, and the results back to the run', async ({ page }) => {
  await open(page, `/app/backtests/${SEEDED_TRADES.execution_id}`);
  await page.getByRole('link', { name: /View results/ }).click();
  await expect(page).toHaveURL(new RegExp(`${resultsPath(SEEDED_TRADES.execution_id)}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Backtest results' })).toBeVisible();
  await page.getByRole('link', { name: /^\W Backtest$/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/backtests/${SEEDED_TRADES.execution_id}$`));
});
