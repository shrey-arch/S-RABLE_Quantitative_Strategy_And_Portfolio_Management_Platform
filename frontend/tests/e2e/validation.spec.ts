import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import { coverage } from '../../src/features/instruments/market-data-fixture';
import {
  DEPLOY_STAGE5_DONE,
  DEPLOY_STAGE5_READY,
  DEPLOY_STAGE5_RUNNING,
  DEPLOY_STAGE5_STARTED,
} from '../../src/features/paper/deploy-fixture';
import { REGISTRY_FIXTURE } from '../../src/features/strategies/registry-fixture';
import {
  VALIDATION_REPORT,
  VALIDATION_SUMMARY,
} from '../../src/features/validation/validation-fixture';
import type { ValidationReport } from '../../src/features/validation/validation-model';
import {
  MR_MODEL_GMM,
  MR_MODEL_SUP,
  MR_MODELS,
  MR_REPORT_SUP,
} from '../../src/features/validation/model-regime-fixture';
import { formatNumber } from '../../src/lib/format';

/**
 * Phase 11: the validation pages in a real browser. A fake of the API answers every
 * request with a validation report made by the backend's own code.
 */

const USER = { id: 'u-1', full_name: 'Val Test', email: 'v@example.com', account_status: 'ACTIVE' };
const RELIANCE = INSTRUMENTS_FIXTURE[0]!;
const ID = VALIDATION_REPORT.id;
const NEW_ID = 'v0000000-0000-4000-8000-000000000002';
const READY = DEPLOY_STAGE5_READY;

const STRATEGY = {
  id: 's1',
  user_id: 'u-1',
  name: 'Nifty momentum',
  description: null,
  strategy_type: 'PYTHON',
  strategy_config: {
    parameters: { template: 'momentum', lookback: 10 },
    indicators: [],
    entry_conditions: [],
    exit_conditions: [],
  },
  python_code: null,
  version: 1,
  is_active: true,
  created_at: '2026-10-01T10:00:00+00:00',
  updated_at: '2026-10-01T10:00:00+00:00',
};

const running: ValidationReport = {
  ...VALIDATION_REPORT,
  id: NEW_ID,
  status: 'RUNNING',
  completed_at: null,
  verdict: { status: 'PENDING', reason: 'The validation has not finished.' },
  stage_statuses: {
    backtest: 'RUNNING',
    walk_forward: 'NOT_RUN',
    regime_stress: 'NOT_RUN',
    monte_carlo: 'NOT_RUN',
    paper_trading: 'NOT_RUN',
  },
  stages: {
    ...VALIDATION_REPORT.stages,
    backtest: {
      ...VALIDATION_REPORT.stages.backtest,
      status: 'RUNNING',
      checks: [],
      metrics: null,
    },
    walk_forward: {
      ...VALIDATION_REPORT.stages.walk_forward,
      status: 'NOT_RUN',
      checks: [],
      windows: [],
      summary: null,
      settings: null,
    },
    regime_stress: {
      ...VALIDATION_REPORT.stages.regime_stress,
      status: 'NOT_RUN',
      checks: [],
      method: null,
    },
    monte_carlo: {
      ...VALIDATION_REPORT.stages.monte_carlo,
      status: 'NOT_RUN',
      checks: [],
      bootstrap: null,
      significance: null,
    },
  },
};

async function open(page: Page, path: string) {
  const fake = {
    posts: [] as Record<string, unknown>[],
    reads: 0,
    paper: [] as unknown[],
  };
  await page.route(
    (url) =>
      ['/users/me', '/instruments', '/strategies', '/strategy-registry', '/validations'].some(
        (p) => url.pathname === p || url.pathname.startsWith(`${p}/`),
      ) ||
      url.pathname.startsWith('/regime/') ||
      url.pathname.startsWith('/executions') ||
      url.pathname.startsWith('/paper/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      if (path === '/instruments') return route.fulfill({ json: INSTRUMENTS_FIXTURE });
      if (path === '/strategy-registry') return route.fulfill({ json: REGISTRY_FIXTURE });
      if (path === '/strategies') return route.fulfill({ json: [STRATEGY] });
      if (path === '/strategies/s1') return route.fulfill({ json: STRATEGY });
      if (path.endsWith('/validate')) return route.fulfill({ json: {} });
      if (path.endsWith('/market-data/coverage')) {
        const start = url.searchParams.get('start_date');
        const end = url.searchParams.get('end_date');
        return route.fulfill({
          json: coverage({
            row_count: start ? 260 : 400,
            first_timestamp: `${start ?? '2023-01-02'}T00:00:00Z`,
            last_timestamp: `${end ?? '2024-06-30'}T00:00:00Z`,
            trading_days: { ...coverage().trading_days, missing_days: 0, missing_periods: [] },
          }),
        });
      }
      if (path === '/validations' && request.method() === 'POST') {
        fake.posts.push(request.postDataJSON() as Record<string, unknown>);
        return route.fulfill({
          status: 201,
          json: { id: NEW_ID, status: 'PENDING', execution_type: 'VALIDATION' },
        });
      }
      if (path === `/paper/deployments/from-validation/${READY.id}`) {
        fake.paper.push(request.postDataJSON());
        return route.fulfill({ status: 201, json: DEPLOY_STAGE5_STARTED });
      }
      // Stage 5 of a validation whose stages 1 to 4 passed: running once started.
      if (path === `/validations/${READY.id}`)
        return route.fulfill({
          json: fake.paper.length ? { ...DEPLOY_STAGE5_RUNNING, id: READY.id } : READY,
        });
      if (path === '/regime/models') return route.fulfill({ json: MR_MODELS });
      if (path.startsWith('/regime/models/'))
        return route.fulfill({
          json: path.endsWith(MR_MODEL_GMM.id) ? MR_MODEL_GMM : MR_MODEL_SUP,
        });
      if (path === `/validations/${MR_REPORT_SUP.id}`)
        return route.fulfill({ json: MR_REPORT_SUP });
      if (path === `/validations/${DEPLOY_STAGE5_DONE.id}`)
        return route.fulfill({ json: DEPLOY_STAGE5_DONE });
      if (path === '/validations') return route.fulfill({ json: [VALIDATION_SUMMARY] });
      if (path === `/validations/${ID}`) return route.fulfill({ json: VALIDATION_REPORT });
      if (path === `/validations/${NEW_ID}`) {
        fake.reads += 1;
        return route.fulfill({
          json: fake.reads < 2 ? running : { ...VALIDATION_REPORT, id: NEW_ID },
        });
      }
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

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('every stage of a seeded validation renders from the API, survives a reload, and fits', async ({
  page,
}) => {
  await open(page, `/app/validation/${ID}`);
  const pipeline = page.getByRole('navigation', { name: 'Validation pipeline' });
  await expect(pipeline.getByRole('button')).toHaveText([
    /1\. Backtest\s*Fail/,
    /2\. Walk-forward\s*Pass/,
    /3\. Regime stress\s*Pass/,
    /4\. Monte Carlo\s*Pass/,
    /5\. Paper trading\s*Not run/,
  ]);
  await expect(page.getByRole('group', { name: 'Overall verdict' })).toContainText(
    VALIDATION_REPORT.verdict.reason,
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  const stages: [string, string, RegExp][] = [
    ['Backtest', 'Historical backtest checks', /Equity curve of the validation backtest/],
    ['Walk-forward', 'Walk-forward checks', /Annualised mean return by window/],
    ['Regime stress', 'Regime stress checks', /regime periods shaded/],
    ['Monte Carlo', 'Monte Carlo and significance checks', /simulated returns/],
  ];
  for (const [name, checks, chart] of stages) {
    await page.getByRole('tab', { name }).click();
    const panel = page.getByRole('tabpanel', { name });
    await expect(panel.getByRole('table', { name: checks })).toBeVisible();
    await expect(panel.getByRole('img', { name: chart })).toBeVisible();
    expect(await overflow(page), `sideways scroll on ${name}`).toBeLessThanOrEqual(1);
  }
  const regime = page.getByRole('img', { name: /regime periods shaded/ });
  await page.getByRole('tab', { name: 'Regime stress' }).click();
  await expect(regime).toHaveAttribute(
    'data-period-count',
    String(VALIDATION_REPORT.stages.regime_stress.periods.length),
  );
  await expect(regime.locator('canvas').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Configuration' }).click();
  const repro = page.getByRole('region', { name: 'Reproducibility' });
  await expect(repro).toContainText('Monte Carlo seed11');
  await expect(repro).toContainText(String(VALIDATION_REPORT.data_provenance!.data_fingerprint));
  await expect(page).toHaveURL(/\?tab=configuration$/);
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: 'Configuration' })).toBeVisible();
});

test('paper trading waits for stages 1 to 4 to pass', async ({ page }) => {
  await open(page, `/app/validation/${ID}?tab=paper_trading`);
  const panel = page.getByRole('tabpanel', { name: 'Paper trading' });
  await expect(panel).toContainText('It can start once stages 1 to 4 have passed.');
  await expect(panel.getByRole('button', { name: /Start paper trading/ })).toHaveCount(0);
});

test('stage 5 starts on the paper account and shows its progress, then Validated', async ({
  page,
}) => {
  const fake = await open(page, `/app/validation/${READY.id}?tab=paper_trading`);
  const panel = page.getByRole('tabpanel', { name: 'Paper trading' });
  await expect(panel).toContainText(READY.stages.paper_trading.reason!);
  await panel.getByLabel(/Capital/).fill('100000');
  await panel.getByLabel(/Loss limit/).fill('20');
  await panel.getByRole('button', { name: 'Start paper trading' }).click();
  await expect(panel.getByRole('group', { name: 'Trading days' })).toContainText('14 of 21');
  expect(fake.paper).toEqual([{ capital: 100000, loss_limit: 0.2 }]);
  await expect(panel.getByRole('link', { name: 'Open the paper deployment' })).toHaveAttribute(
    'href',
    `/app/live/deployments/${DEPLOY_STAGE5_RUNNING.stages.paper_trading.paper!.deployment_id}`,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await page.goto(`/app/validation/${DEPLOY_STAGE5_DONE.id}?tab=paper_trading`);
  await expect(page.getByRole('group', { name: 'Overall verdict' })).toContainText(
    'Overall: Validated',
  );
  await expect(
    page.getByRole('table', { name: 'Paper trading checks' }).getByRole('row'),
  ).toHaveCount(DEPLOY_STAGE5_DONE.stages.paper_trading.checks.length + 1);
});

test('the launcher submits a validation and its report fills in as it runs', async ({ page }) => {
  const fake = await open(page, '/app/validation/new?strategy=s1');
  await expect(page.getByRole('heading', { level: 1, name: 'New validation' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Instrument' }).selectOption(RELIANCE.id);
  await page.getByLabel('From', { exact: true }).fill('2023-01-02');
  await page.getByLabel('To', { exact: true }).fill('2023-09-18');
  await expect(page.getByText(/260 daily bars/).first()).toBeVisible();
  await page.getByRole('textbox', { name: 'Train span (bars)' }).fill('40');
  await page.getByRole('textbox', { name: 'Validation span (bars)' }).fill('20');
  await page.getByRole('textbox', { name: 'Test span (bars)' }).fill('20');
  await expect(page.getByText(/With 260 daily bars in the range: 10 windows/)).toBeVisible();
  await page.getByRole('textbox', { name: 'lookback candidates' }).fill('5, 10');
  await page.getByRole('textbox', { name: 'Seed' }).fill('11');
  await page.getByRole('button', { name: /Review validation/ }).click();
  await expect(page.getByRole('region', { name: 'Review' })).toContainText(
    'Parameter searchlookback in {5, 10}',
  );
  await page.getByRole('button', { name: /Submit validation/ }).dblclick();

  await expect(page).toHaveURL(new RegExp(`/app/validation/${NEW_ID}$`));
  expect(fake.posts).toHaveLength(1);
  expect(fake.posts[0]).toMatchObject({
    strategy_id: 's1',
    walk_forward: {
      train_bars: 40,
      validation_bars: 20,
      test_bars: 20,
      parameter_grid: { lookback: [5, 10] },
    },
    monte_carlo: { simulations: 1000, seed: 11 },
  });
  const pipeline = page.getByRole('navigation', { name: 'Validation pipeline' });
  await expect(pipeline.getByRole('button').first()).toHaveText(/1\. Backtest\s*Running/);
  await expect(page.getByText(/Status: Running\./)).toBeVisible();
  // The next read has every stage.
  await expect(page.getByText('Status: Completed. This is final.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(pipeline.getByRole('button').nth(3)).toHaveText(/4\. Monte Carlo\s*Pass/);
});

test('the history lists validations with verdicts and links to each report', async ({ page }) => {
  await open(page, '/app/validation');
  const table = page.getByRole('table', { name: 'Validations' });
  const row = table.getByRole('row').nth(1);
  await expect(row).toContainText('Nifty momentum');
  await expect(row).toContainText('Failed');
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(new RegExp(`/app/validation/${ID}$`));
  await expect(page.getByRole('navigation', { name: 'Validation pipeline' })).toBeVisible();
});

test('stage 3 with the market regime model: the model, in-sample flag, dimensions and shading', async ({
  page,
}) => {
  const stage = MR_REPORT_SUP.stages.regime_stress;
  await open(page, `/app/validation/${MR_REPORT_SUP.id}?tab=regime_stress`);
  const panel = page.getByRole('tabpanel', { name: 'Regime stress' });
  await expect(panel.getByRole('note')).toContainText(stage.in_sample!.flag!);
  await expect(
    panel.getByRole('table', { name: 'Performance by regime' }).getByRole('row'),
  ).toHaveCount(stage.regimes.length + 1);
  for (const d of stage.dimensions!) {
    const rows = panel
      .getByRole('table', { name: `Performance by ${d.name.toLowerCase()}` })
      .getByRole('row');
    await expect(rows).toHaveCount(d.rows.length + 1);
    await expect(rows.nth(1)).toContainText(
      `${d.rows[0]!.name}${formatNumber(d.rows[0]!.days, 0)}`,
    );
  }
  await expect(panel.getByRole('list', { name: 'Unclassified days' })).toContainText(
    stage.unclassified!.reasons[0]!.description,
  );
  const chart = panel.getByRole('img', { name: /regime periods shaded/ });
  await expect(chart).toHaveAttribute('data-period-count', String(stage.periods.length));
  await panel.getByRole('combobox').selectOption('trend');
  await expect(chart).toHaveAttribute(
    'data-period-count',
    String(stage.dimensions!.find((d) => d.key === 'trend')!.periods.length),
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: 'Configuration' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Configuration' })).toContainText(
    `Market regime model: ${stage.method!.model!.name}`,
  );
});
