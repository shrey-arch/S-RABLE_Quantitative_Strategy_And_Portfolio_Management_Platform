import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import {
  LIVE_ACCOUNT,
  LIVE_CREATED,
  LIVE_DONE,
  LIVE_DONE_BARS,
  LIVE_DONE_EVENTS,
  LIVE_DONE_FILLS,
  LIVE_INSTRUMENTS,
  LIVE_REFUSED,
  LIVE_REGISTRY,
  LIVE_REPLAY_DAYS,
  LIVE_RUNNING,
  LIVE_RUNNING_BARS,
  LIVE_RUNNING_EVENTS,
  LIVE_RUNNING_FILLS,
  LIVE_STATUS,
  LIVE_STRATEGIES,
} from '../../src/features/live/live-fixture';
import { formatINR } from '../../src/lib/format';

/**
 * Feature 7: live paper sessions in a real browser. A fake of the API answers
 * with sessions the real runner replayed at 10x on recorded 1-minute bars
 * (live-fixture.ts). The event stream is answered as Server-Sent Events text:
 * the page first has the bars to 10:55; the stream then brings the bars to
 * 11:10 and the 11:15 bar forming, like a market moving.
 */

const USER = {
  id: 'u-1',
  full_name: 'Live Test',
  email: 'l@example.com',
  account_status: 'ACTIVE',
};
const RUN = LIVE_RUNNING.id;
const DONE = LIVE_DONE.id;
const LABEL = 'Virtual money \u00b7 simulated orders';

const sse = (event: string, data: unknown, id?: number) =>
  `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// The page loads with 20 closed bars; the stream adds the other four.
const SPLIT = LIVE_RUNNING_EVENTS.filter((e) => e.kind === 'BAR')[20]!.id;

async function open(page: Page, path: string, opts: { refuse?: boolean } = {}) {
  const fake = {
    session: { ...LIVE_RUNNING },
    delivered: false,
    streams: [] as string[],
    posts: [] as { path: string; body: unknown }[],
  };
  await quietBell(page);
  await page.route(
    (url) =>
      ['/users/me', '/instruments', '/strategies', '/strategy-registry'].includes(url.pathname) ||
      url.pathname.startsWith('/live/') ||
      url.pathname.startsWith('/paper/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const p = url.pathname;
      const method = request.method();
      if (method === 'POST')
        fake.posts.push({
          path: p,
          body: request.postData() ? JSON.parse(request.postData()!) : null,
        });
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/instruments') return route.fulfill({ json: LIVE_INSTRUMENTS });
      if (p === '/strategies') return route.fulfill({ json: LIVE_STRATEGIES });
      if (p === '/strategy-registry') return route.fulfill({ json: LIVE_REGISTRY });
      if (p === '/paper/account') return route.fulfill({ json: LIVE_ACCOUNT });
      if (p === '/live/status') return route.fulfill({ json: LIVE_STATUS });
      if (p === '/live/replay-days') return route.fulfill({ json: LIVE_REPLAY_DAYS });
      if (p === '/live/sessions' && method === 'GET')
        return route.fulfill({ json: [fake.session, LIVE_DONE] });
      if (p === '/live/sessions')
        return opts.refuse
          ? route.fulfill({ status: 422, json: LIVE_REFUSED })
          : route.fulfill({ status: 201, json: LIVE_CREATED });
      if (p === '/live/stop-all') return route.fulfill({ json: { stopping: 1 } });
      const [, , , id, what] = p.split('/');
      const done = id === DONE;
      if (id !== RUN && !done)
        return route.fulfill({ status: 404, json: { detail: 'Live session not found.' } });
      if (what === undefined) return route.fulfill({ json: done ? LIVE_DONE : fake.session });
      if (what === 'bars') {
        if (done) return route.fulfill({ json: LIVE_DONE_BARS });
        return route.fulfill({
          json: fake.delivered
            ? LIVE_RUNNING_BARS
            : { ...LIVE_RUNNING_BARS, bars: LIVE_RUNNING_BARS.bars.slice(0, 20), forming: null },
        });
      }
      if (what === 'events') {
        if (done) return route.fulfill({ json: LIVE_DONE_EVENTS });
        return route.fulfill({
          json: LIVE_RUNNING_EVENTS.filter((e) => fake.delivered || e.id < SPLIT),
        });
      }
      if (what === 'fills') {
        if (done) return route.fulfill({ json: LIVE_DONE_FILLS });
        const last = LIVE_RUNNING_EVENTS.filter((e) => e.id < SPLIT).at(-1)!.market_time!;
        return route.fulfill({
          json: LIVE_RUNNING_FILLS.filter((f) => fake.delivered || f.filled_at <= last),
        });
      }
      if (what === 'stream') {
        const after = Number(url.searchParams.get('after') ?? 0);
        fake.streams.push(String(after));
        let body = LIVE_RUNNING_EVENTS.filter((e) => e.id > after)
          .map((e) => sse(e.kind.toLowerCase(), e, e.id))
          .join('');
        fake.delivered = true;
        body += sse('snapshot', fake.session);
        if (fake.session.status === 'STOPPED') body += sse('end', { status: 'STOPPED' });
        else body += sse('forming', LIVE_RUNNING_BARS.forming);
        return route.fulfill({ body, contentType: 'text/event-stream' });
      }
      if (what === 'stop') {
        fake.session = {
          ...fake.session,
          status: 'STOPPED',
          status_reason: 'Stopped by you; the position was squared off.',
          stop_requested: 'SQUARE_OFF',
          position_qty: 0,
          average_price: null,
        };
        return route.fulfill({ json: fake.session });
      }
      return route.fulfill({ status: 404, json: { detail: 'Not found.' } });
    },
  );
  await page.addInitScript(() => {
    const b64 = (o: object) =>
      btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    sessionStorage.setItem('srable.session', `${b64({ alg: 'HS256' })}.${b64({ exp })}.test`);
  });
  await page.goto(path);
  return fake;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('a replay at 10x is set up, reviewed and started', async ({ page }) => {
  const fake = await open(page, '/app/live');
  await expect(page.getByRole('heading', { level: 1, name: 'Live Trading (Paper)' })).toBeVisible();
  await expect(page.getByText(LABEL).first()).toBeVisible();
  await expect(page.getByRole('table', { name: 'Live sessions' }).getByRole('row')).toHaveCount(3);
  await page.getByRole('link', { name: 'New live session' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New live session' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Delayed live/ })).toBeDisabled();
  const momentum = LIVE_STRATEGIES.find((s) => s.name === 'Intraday momentum')!;
  await page.getByLabel('Strategy').selectOption(momentum.id);
  await expect(page.getByLabel('Strategy').locator('option')).toHaveText([
    'Choose a strategy',
    'Intraday momentum',
  ]);
  await page.getByLabel('Instrument').selectOption(LIVE_INSTRUMENTS[0]!.id);
  await page.getByLabel('Recorded day', { exact: true }).selectOption('2026-10-16');
  await page.getByLabel('Speed').selectOption('10');
  await page.getByLabel('Shares per position').fill('50');
  await expect(
    page.getByText(`The paper account has ${formatINR(LIVE_ACCOUNT.available_cash)} available.`),
  ).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Review' }).click();
  const review = page.getByRole('region', { name: 'Review' });
  await expect(review).toContainText('Replay of 16 Oct 2026 from 09:15 at 10x');
  await expect(review).toContainText(LABEL);
  await review.getByRole('button', { name: 'Start session' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/live/sessions/${LIVE_CREATED.id}$`));
  expect(fake.posts.at(-1)).toEqual({
    path: '/live/sessions',
    body: {
      strategy_id: momentum.id,
      instrument_id: LIVE_INSTRUMENTS[0]!.id,
      name: null,
      timeframe: '5M',
      mode: 'REPLAY',
      replay_date: '2026-10-16',
      speed: 10,
      capital: 200000,
      quantity: 50,
      slippage_bps: 5,
      loss_limit_pct: 2,
      max_position_value: null,
    },
  });
});

test("the backend's refusal is shown on the Review", async ({ page }) => {
  await open(page, '/app/live/new', { refuse: true });
  await page
    .getByLabel('Strategy')
    .selectOption(LIVE_STRATEGIES.find((s) => s.name === 'Intraday momentum')!.id);
  await page.getByLabel('Instrument').selectOption(LIVE_INSTRUMENTS[0]!.id);
  await page.getByLabel('Recorded day', { exact: true }).selectOption('2026-10-16');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(page.getByRole('alert')).toContainText(LIVE_REFUSED.detail);
});

test('bars arrive on the stream and the current bar forms; Stop squares off', async ({ page }) => {
  const fake = await open(page, `/app/live/sessions/${RUN}`);
  await expect(page.getByTestId('session-clock')).toContainText('Replay of 16 Oct 2026 \u00b7 10x');
  const chart = page.getByRole('img', { name: /5M bars/ });
  const f = LIVE_RUNNING_BARS.forming!;
  // From 20 closed bars to all 24, with the 11:15 bar forming.
  await expect(chart).toHaveAttribute('data-bar-count', String(LIVE_RUNNING_BARS.bars.length));
  await expect(chart).toHaveAttribute('data-forming', `${f.minutes}/${f.of}`);
  await expect(chart).toHaveAttribute('data-marker-count', String(LIVE_RUNNING_FILLS.length));
  await expect(chart).toHaveAttribute('data-last-close', String(f.close));
  await expect(page.getByTestId('forming-note')).toContainText(`${f.minutes} of ${f.of} minutes`);
  expect(fake.streams[0]).toBe('0');
  await expect(page.getByRole('table', { name: 'Session fills' }).getByRole('row')).toHaveCount(
    LIVE_RUNNING_FILLS.length + 1,
  );
  const log = page.getByRole('region', { name: 'Event log' });
  await log.getByRole('button', { name: 'Signals' }).click();
  await expect(log.getByRole('listitem')).toHaveCount(
    LIVE_RUNNING_EVENTS.filter((e) => e.kind === 'SIGNAL').length,
  );
  const tiles = page.getByRole('region', { name: 'Position and P&L' });
  await expect(tiles).toContainText(formatINR(LIVE_RUNNING.money.equity));
  await expect(page.getByRole('region', { name: 'Risk limits' })).toContainText(
    `${formatINR(LIVE_RUNNING.risk.position_value)} of ${formatINR(LIVE_RUNNING.risk.position_limit)}`,
  );
  await expect(page.getByText(LABEL)).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stop this session?' });
  await dialog.getByRole('button', { name: 'Stop and square off now' }).click();
  await expect(page.getByTestId('status-reason')).toContainText('Stopped by you');
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(fake.posts.at(-1)).toEqual({
    path: `/live/sessions/${RUN}/stop`,
    body: { square_off: true },
  });
});

test('a finished session shows its summary, the whole day and every fill', async ({ page }) => {
  await open(page, `/app/live/sessions/${DONE}`);
  const summary = page.getByRole('region', { name: 'Session summary' });
  const sum = LIVE_DONE.summary as Record<string, number>;
  await expect(summary).toContainText(formatINR(sum.net_pnl));
  const chart = page.getByRole('img', { name: /5M bars/ });
  await expect(chart).toHaveAttribute('data-bar-count', String(LIVE_DONE_BARS.bars.length));
  await expect(chart).toHaveAttribute('data-forming', '');
  await expect(chart.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Session equity' })).toHaveAttribute(
    'data-points',
    String(LIVE_DONE_EVENTS.filter((e) => e.kind === 'EQUITY').length),
  );
  await expect(page.getByRole('table', { name: 'Session fills' })).toContainText(
    'Auto square-off at 15:20 (intraday)',
  );
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await page.getByRole('link', { name: 'All fills in the paper account' }).click();
  await expect(page).toHaveURL(/\/app\/live\?tab=account&view=fills$/);
});

test('old paper addresses lead to Live Trading (Paper)', async ({ page }) => {
  await open(page, '/app/paper?tab=fills');
  await expect(page).toHaveURL(/\/app\/live\?tab=account&view=fills$/);
  await page.goto('/app/paper/deployments/abc');
  await expect(page).toHaveURL(/\/app\/live\/deployments\/abc$/);
});
