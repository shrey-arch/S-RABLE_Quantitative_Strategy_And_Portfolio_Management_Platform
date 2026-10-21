import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { SEEDED_TRADES } from '../../src/features/results/results-fixture';
import { formatNumber } from '../../src/lib/format';
import {
  REGIME_FIT,
  SCORES,
  SCORES_CUSTOM,
  SCORING_DEFINITIONS,
} from '../../src/features/scoring/scoring-fixture';
import { scoreText } from '../../src/features/scoring/scoring-model';

/**
 * Phase 13: multi-factor scoring in a real browser. A fake of the API answers with
 * the scores made by the backend's own code; the page must show them unchanged.
 */

const USER = {
  id: 'u-1',
  full_name: 'Scoring Test',
  email: 's@example.com',
  account_status: 'ACTIVE',
};
const SCORED = SCORES.rows.filter((r) => r.status === 'SCORED');
const CUSTOM = SCORES_CUSTOM.rows.filter((r) => r.status === 'SCORED');

async function open(page: Page, path: string) {
  const sent: unknown[] = [];
  await page.route(
    (url) =>
      [
        '/users/me',
        '/strategies',
        '/brokers/accounts',
        '/instruments',
        '/portfolio/accounts',
        '/scoring',
        '/validations',
        '/live/sessions',
      ].includes(url.pathname) ||
      url.pathname.startsWith('/scoring/') ||
      url.pathname.startsWith('/regime/') ||
      url.pathname.startsWith('/executions/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const p = new URL(request.url()).pathname;
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/validations' || p === '/live/sessions') return route.fulfill({ json: [] });
      if (p === '/scoring/definitions') return route.fulfill({ json: SCORING_DEFINITIONS });
      if (p === '/scoring/regime-fit') return route.fulfill({ json: REGIME_FIT });
      if (p === '/scoring') {
        const body = request.postDataJSON() as { weights?: unknown };
        sent.push(body);
        return route.fulfill({ json: body.weights ? SCORES_CUSTOM : SCORES });
      }
      if (p.endsWith('/results')) return route.fulfill({ json: SEEDED_TRADES });
      if (p.startsWith('/regime/'))
        return route.fulfill({
          status: 404,
          json: { detail: 'No regime model has been trained yet.' },
        });
      return route.fulfill({ json: [] });
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
  return sent;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('the ranking and breakdown show the API scores unchanged', async ({ page }) => {
  await open(page, '/app/scoring');
  await expect(page.getByRole('heading', { level: 1, name: 'Scoring' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Current regime' })).toContainText(
    SCORES.regime!.name,
  );
  const rows = page.getByRole('table', { name: 'Strategy ranking' }).getByRole('row');
  await expect(rows).toHaveCount(SCORED.length + 1);
  for (const [i, s] of SCORED.entries()) {
    await expect(rows.nth(i + 1)).toContainText(s.name);
    await expect(rows.nth(i + 1)).toContainText(scoreText(s.composite_score));
  }
  // The stacked bar: one segment per factor, with the API contributions.
  const first = SCORED[0]!;
  const breakdown = page.getByRole('region', { name: `Breakdown: ${first.name}` });
  const segments = breakdown.locator('[data-factor]');
  await expect(segments).toHaveCount(first.factors.length);
  for (const [i, f] of first.factors.entries())
    await expect(segments.nth(i)).toHaveAttribute('data-contribution', String(f.contribution));
  await expect(
    breakdown.getByRole('table', { name: 'Factor breakdown' }).getByRole('row').last(),
  ).toContainText(scoreText(first.composite_score));
  // Another breakdown, kept over a reload.
  const other = SCORED[3]!;
  await page.getByRole('button', { name: `Breakdown of ${other.name}` }).click();
  await expect(page.getByRole('region', { name: `Breakdown: ${other.name}` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: `Breakdown: ${other.name}` })).toBeVisible();
  // Not scored, with the reason.
  const unscored = page.getByRole('region', { name: 'Not scored' });
  for (const s of SCORES.rows.filter((r) => r.status !== 'SCORED'))
    await expect(unscored).toContainText(s.reason!);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('two strategies compared side by side with their latest backtest metrics', async ({
  page,
}) => {
  await open(page, '/app/scoring');
  // The choice goes into the address (a router transition), so wait for it.
  for (const s of SCORED.slice(0, 2)) {
    const box = page.getByRole('checkbox', { name: `Compare ${s.name}` });
    await box.click();
    await expect(box).toBeChecked();
  }
  await page.getByRole('tab', { name: 'Compare' }).click();
  const table = page.getByRole('table', { name: 'Strategy comparison' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Measure',
    SCORED[0]!.name,
    SCORED[1]!.name,
  ]);
  await expect(table.getByRole('row', { name: /^Composite score/ })).toContainText(
    `${scoreText(SCORED[0]!.composite_score)}${scoreText(SCORED[1]!.composite_score)}`,
  );
  // Ratios are shown to 2 decimals (results page format).
  await expect(table.getByRole('row', { name: /^Backtest: Sharpe ratio/ })).toContainText(
    formatNumber(SEEDED_TRADES.summary.sharpe_ratio!, 2),
  );
  // The choice is in the address.
  await page.reload();
  await expect(table.getByRole('columnheader')).toHaveCount(3);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('custom weights are sent once and re-rank the strategies', async ({ page }) => {
  const sent = await open(page, '/app/scoring?tab=weights');
  const weight = (name: string) => page.getByRole('textbox', { name: `Momentum: ${name} weight` });
  await weight('Trend strength').fill('3');
  await weight('Volatility suitability').fill('0');
  await page.getByRole('button', { name: 'Re-score with these weights' }).dblclick();
  await expect(page.getByText('Custom weights in use')).toBeVisible();
  expect(sent).toEqual([
    {},
    {
      weights: { momentum: { trend_strength: 3, relative_momentum: 1, volatility_suitability: 0 } },
    },
  ]);
  await page.getByRole('tab', { name: 'Ranking' }).click();
  const rows = page.getByRole('table', { name: 'Strategy ranking' }).getByRole('row');
  for (const [i, s] of CUSTOM.entries()) {
    await expect(rows.nth(i + 1)).toContainText(s.name);
    await expect(rows.nth(i + 1)).toContainText(scoreText(s.composite_score));
  }
  // Reset goes back to the defaults; nothing is saved.
  await page.getByRole('tab', { name: 'Weights and definitions' }).click();
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(weight('Trend strength')).toHaveValue('1');
  await expect(page.getByText('Custom weights in use')).toHaveCount(0);
});

test('the dashboard shows the top three strategies by score', async ({ page }) => {
  await open(page, '/app/dashboard');
  const widget = page.getByRole('region', { name: 'Top strategies by score' });
  const items = widget.getByRole('listitem');
  await expect(items).toHaveCount(3);
  for (const [i, s] of SCORED.slice(0, 3).entries())
    await expect(items.nth(i)).toContainText(`Score ${scoreText(s.composite_score)}`);
  await widget.getByRole('link', { name: /Open scoring/ }).click();
  await expect(page.getByRole('table', { name: 'Strategy ranking' })).toBeVisible();
});
