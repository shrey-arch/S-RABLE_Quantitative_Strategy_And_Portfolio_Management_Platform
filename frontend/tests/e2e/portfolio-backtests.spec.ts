import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import {
  PB_BACKTESTS,
  PB_CREATED,
  PB_DETAIL,
  PB_FAILED,
  PB_INSTRUMENTS,
  PB_LIST,
  PB_MODEL,
  PB_MODELS,
  PB_RESULTS,
  PB_STRATEGIES,
} from '../../src/features/portfolio-backtests/pb-fixture';
import { formatINR, formatPercent } from '../../src/lib/format';

/**
 * Feature 4: the portfolio backtest pages in a real browser. A fake of the API
 * answers with runs made by the backend's own code and worker.
 */

const USER = {
  id: 'u-1',
  full_name: 'Folio Test',
  email: 'f@example.com',
  account_status: 'ACTIVE',
};
const ID = PB_DETAIL.id;
const R = PB_RESULTS;

async function open(page: Page, path: string) {
  const fake = { posts: [] as Record<string, unknown>[], reads: 0 };
  await page.route(
    (url) =>
      ['/users/me', '/instruments', '/strategies', '/executions', '/portfolio-backtests'].some(
        (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
      ) || url.pathname.startsWith('/regime/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const path = new URL(request.url()).pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      if (path === '/instruments') return route.fulfill({ json: PB_INSTRUMENTS });
      if (path === '/strategies') return route.fulfill({ json: PB_STRATEGIES });
      if (path === '/executions') return route.fulfill({ json: PB_BACKTESTS });
      if (path === '/regime/models') return route.fulfill({ json: PB_MODELS });
      if (path.startsWith('/regime/models/')) return route.fulfill({ json: PB_MODEL });
      if (path === '/portfolio-backtests' && request.method() === 'POST') {
        fake.posts.push(request.postDataJSON() as Record<string, unknown>);
        return route.fulfill({ status: 201, json: PB_CREATED });
      }
      if (path === '/portfolio-backtests') return route.fulfill({ json: PB_LIST });
      if (path === `/portfolio-backtests/${ID}`) {
        fake.reads += 1;
        // A new run is PENDING at first, then completed.
        return route.fulfill({
          json:
            fake.posts.length && fake.reads < 2
              ? { ...PB_CREATED, status: 'PENDING', headline: null }
              : PB_DETAIL,
        });
      }
      if (path === `/portfolio-backtests/${ID}/results`) return route.fulfill({ json: R });
      if (path === `/portfolio-backtests/${PB_FAILED.id}`)
        return route.fulfill({ json: PB_FAILED });
      return route.fulfill({ status: 404, json: { detail: 'Portfolio backtest not found.' } });
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

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function expectResults(page: Page) {
  for (const [key, label] of [
    ['sharpe_improvement', 'Sharpe ratio improvement'],
    ['drawdown_reduction', 'Maximum drawdown reduction'],
  ] as const) {
    const o = R.objectives[key];
    const box = page.getByRole('group', { name: label });
    await expect(box).toContainText(`${label}: ${o.met ? 'met' : 'not met'}`);
    await expect(box).toContainText(formatPercent(o.value));
  }
  const equity = page.getByRole('img', { name: 'Portfolio value against the benchmarks' });
  await expect(equity).toHaveAttribute('data-series', 'portfolio,nifty,equal_weight,sixty_forty');
  await expect(equity).toHaveAttribute('data-total-points', String(R.days.length));
  await expect(equity).toHaveAttribute(
    'data-last-values',
    ['portfolio', 'nifty', 'equal_weight', 'sixty_forty'].map((k) => R.series[k]!.at(-1)).join(','),
  );
  await expect(page.getByRole('img', { name: 'Drawdowns' })).toHaveAttribute(
    'data-last-values',
    ['portfolio', 'nifty', 'equal_weight', 'sixty_forty']
      .map((k) => R.drawdowns[k]!.at(-1))
      .join(','),
  );
  await expect(page.getByRole('img', { name: 'Weights at each rebalance' })).toHaveAttribute(
    'data-rebalance-count',
    String(R.rebalance_count),
  );
  const metrics = page.getByRole('table', { name: 'Performance metrics' });
  await expect(
    metrics
      .getByRole('row', { name: /^Final value/ })
      .getByRole('cell')
      .first(),
  ).toHaveText(formatINR(R.metrics.portfolio!.final_value));
  await expect(
    metrics
      .getByRole('row', { name: /^Maximum drawdown/ })
      .getByRole('cell')
      .nth(1),
  ).toHaveText(formatPercent(R.metrics.nifty!.max_drawdown));
  await expect(page.getByText(R.notes[0]!)).toBeVisible();
  await expect(page.getByText(`1-25 of ${R.rebalances.length}`)).toBeVisible();
}

test('a completed portfolio backtest shows the API results, survives a reload, and fits', async ({
  page,
}) => {
  await open(page, `/app/portfolio-backtests/${ID}`);
  await expect(page.getByRole('heading', { level: 1, name: PB_DETAIL.name })).toBeVisible();
  await expectResults(page);
  await page.reload();
  await expectResults(page);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: 'Sharpe ratio improvement' })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test('a new portfolio backtest is reviewed, submitted, followed and shown', async ({ page }) => {
  const fake = await open(page, '/app/portfolio-backtests/new');
  const nifty = PB_INSTRUMENTS.find((i) => i.symbol === 'NIFTY50')!;
  await expect(page.getByRole('combobox', { name: 'Benchmark' })).toHaveValue(nifty.id);
  await expect(page.getByRole('combobox', { name: 'Regime model' })).toHaveValue(PB_MODELS[0]!.id);
  for (const s of PB_DETAIL.strategies)
    await page.getByRole('checkbox', { name: new RegExp(s.name) }).check();
  await page.getByLabel('From', { exact: true }).fill(PB_DETAIL.start_date);
  await page.getByLabel('To', { exact: true }).fill(PB_DETAIL.end_date);
  await page.getByRole('textbox', { name: 'Cash reserve (%)' }).fill('5');
  await page.getByRole('textbox', { name: 'Most per strategy (%)' }).fill('50');
  await page.getByRole('switch', { name: 'Also compare with 60/40' }).click();
  await page.getByRole('button', { name: 'Review portfolio backtest' }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toContainText('and 60/40');
  await page.getByRole('button', { name: /Submit portfolio backtest/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/portfolio-backtests/${ID}$`));
  expect(fake.posts).toHaveLength(1);
  expect(fake.posts[0]).toMatchObject({
    strategy_ids: PB_DETAIL.strategies.map((s) => s.strategy_id),
    benchmark_instrument_id: nifty.id,
    start_date: PB_DETAIL.start_date,
    end_date: PB_DETAIL.end_date,
    frequency: 'WEEKLY',
    limits: PB_DETAIL.limits,
    regime_filter: true,
    sixty_forty: true,
  });
  await expect(page.getByText('Status: Completed. This is final.')).toBeVisible({
    timeout: 10_000,
  });
  await expectResults(page);
});

test('the list leads to each run, and a failed run says why', async ({ page }) => {
  await open(page, '/app/portfolio-backtests');
  await expect(page.getByRole('heading', { level: 1, name: 'Portfolio backtests' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Portfolio backtests' });
  await expect(table.getByRole('row')).toHaveCount(PB_LIST.length + 1);
  const failed = table.getByRole('row', { name: new RegExp(PB_FAILED.name) });
  await failed.getByRole('link').first().click();
  await expect(page.getByText('Status: Failed. This is final.')).toBeVisible();
  await expect(page.getByText(PB_FAILED.error_message!)).toBeVisible();
});
