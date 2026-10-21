import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INSTRUMENTS_FIXTURE } from '../../src/features/instruments/instrument-fixture';
import { coverage } from '../../src/features/instruments/market-data-fixture';
import {
  CURRENT_REGIME,
  REGIME_HISTORY,
  REGIME_MODEL,
  REGIME_MODELS,
} from '../../src/features/regime/regime-fixture';
import {
  SUP_CURRENT,
  SUP_HISTORY,
  SUP_INSTRUMENTS,
  SUP_MODEL,
  SUP_MODELS,
} from '../../src/features/regime/supervised-fixture';
import { REGIME_FIT, REGIME_FIT_UNKNOWN, SCORES } from '../../src/features/scoring/scoring-fixture';
import { formatPercent } from '../../src/lib/format';
import { COMPATIBILITY_LABELS } from '../../src/features/scoring/scoring-model';

/**
 * Phase 12 and Feature 2: the market regime page in a real browser. A fake of the
 * API answers with the regime models (Gaussian mixture, or supervised with
 * `supervised`), current regime and history made by the backend's own code.
 */

const USER = {
  id: 'u-1',
  full_name: 'Regime Test',
  email: 'r@example.com',
  account_status: 'ACTIVE',
};
const NO_MODEL = { status: 404, json: { detail: 'No regime model has been trained yet.' } };

interface Fake {
  models: unknown[];
  trained: Record<string, unknown>[];
  historyQueries: string[];
}

async function open(
  page: Page,
  path: string,
  options: { noModel?: boolean; supervised?: boolean } = {},
) {
  const sup = options.supervised;
  const fake: Fake = {
    models: options.noModel ? [] : sup ? SUP_MODELS : REGIME_MODELS,
    trained: [],
    historyQueries: [],
  };
  await page.route(
    (url) =>
      [
        '/users/me',
        '/instruments',
        '/strategies',
        '/brokers/accounts',
        '/portfolio/accounts',
        '/scoring',
        '/validations',
        '/live/sessions',
      ].includes(url.pathname) ||
      url.pathname.startsWith('/scoring/') ||
      url.pathname.startsWith('/regime/') ||
      url.pathname.startsWith('/instruments/'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const url = new URL(request.url());
      const p = url.pathname;
      if (p === '/users/me') return route.fulfill({ json: USER });
      if (p === '/instruments')
        return route.fulfill({ json: [...INSTRUMENTS_FIXTURE, ...SUP_INSTRUMENTS] });
      if (
        [
          '/strategies',
          '/brokers/accounts',
          '/portfolio/accounts',
          '/validations',
          '/live/sessions',
        ].includes(p)
      )
        return route.fulfill({ json: [] });
      if (p === '/scoring/regime-fit')
        return route.fulfill({ json: options.noModel ? REGIME_FIT_UNKNOWN : REGIME_FIT });
      if (p === '/scoring') return route.fulfill({ json: SCORES });
      if (p.endsWith('/market-data/coverage'))
        return route.fulfill({ json: coverage({ row_count: sup ? 1100 : 600 }) });
      if (p === '/regime/models' && request.method() === 'POST') {
        fake.trained.push(request.postDataJSON() as Record<string, unknown>);
        const training = {
          ...(sup ? SUP_MODEL : REGIME_MODEL),
          id: 'm-2',
          number: 2,
          status: 'TRAINING',
          is_active: false,
          card: null,
        };
        fake.models = [training, ...fake.models];
        return route.fulfill({ status: 202, json: training });
      }
      if (p === '/regime/models') return route.fulfill({ json: fake.models });
      if (p.startsWith('/regime/models/'))
        return route.fulfill({ json: sup ? SUP_MODEL : REGIME_MODEL });
      if (options.noModel) return route.fulfill(NO_MODEL);
      if (p === '/regime/current')
        return route.fulfill({ json: sup ? SUP_CURRENT : CURRENT_REGIME });
      if (p === '/regime/history') {
        fake.historyQueries.push(url.search);
        return route.fulfill({ json: sup ? SUP_HISTORY : REGIME_HISTORY });
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

test('current regime, labelled history bands and transitions come from the API, and fit', async ({
  page,
}) => {
  const fake = await open(page, '/app/regime?from=2023-11-01&to=2024-04-30');
  await expect(page.getByRole('heading', { level: 1, name: 'Market Regime' })).toBeVisible();
  const card = page.getByRole('region', { name: 'Current regime' });
  await expect(card.getByTestId('regime-name')).toHaveText(CURRENT_REGIME.regime.name);
  await expect(card).toContainText('not a forecast');
  const chart = page.getByRole('img', { name: /regime periods labelled/ });
  await expect(chart).toHaveAttribute('data-bands', String(REGIME_HISTORY.periods.length));
  const bands = chart.locator('[data-band]');
  await expect(bands).toHaveCount(REGIME_HISTORY.periods.length);
  for (const [i, period] of REGIME_HISTORY.periods.entries()) {
    await expect(bands.nth(i)).toHaveAttribute('data-start', period.start);
    await expect(bands.nth(i)).toHaveAttribute('data-end', period.end);
  }
  // Bands are labelled with text, not colour alone.
  await expect(bands.locator('text').first()).toHaveText(/^R\d$/);
  await expect(
    page.getByRole('table', { name: 'Regime transitions' }).getByRole('row'),
  ).toHaveCount(REGIME_HISTORY.transitions.length + 1);
  expect(fake.historyQueries.at(-1)).toBe('?start_date=2023-11-01&end_date=2024-04-30');
  // Strategy fit: the documented rule for each template against the current regime.
  const fit = page.getByRole('list', { name: 'Strategy fit' }).getByRole('listitem');
  await expect(fit).toHaveCount(REGIME_FIT.strategies.length);
  for (const [i, s] of REGIME_FIT.strategies.entries()) {
    await expect(fit.nth(i)).toContainText(s.rule.rule);
    await expect(fit.nth(i)).toContainText(COMPATIBILITY_LABELS[s.compatibility.status]);
  }
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(chart).toBeVisible();
  await expect(page).toHaveURL(/from=2023-11-01&to=2024-04-30/);

  await page.getByRole('tab', { name: 'Model card' }).click();
  await expect(page.getByRole('region', { name: 'Reported performance' })).toContainText(
    'no accuracy figure',
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('without a model nothing is classified, and the dashboard says so', async ({ page }) => {
  await open(page, '/app/regime', { noModel: true });
  await expect(page.getByText('No regime model yet')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Current regime' })).toHaveCount(0);
  await page.goto('/app/dashboard');
  const widget = page.getByRole('region', { name: 'Market regime' });
  await expect(widget).toContainText('No regime model yet.');
  await widget.getByRole('link', { name: 'Train one' }).click();
  await expect(page).toHaveURL(/\/app\/regime\?tab=training$/);
});

test('the dashboard widget shows the current regime from the API', async ({ page }) => {
  await open(page, '/app/dashboard');
  const widget = page.getByRole('region', { name: 'Market regime' });
  await expect(widget).toContainText(CURRENT_REGIME.regime.name);
  await expect(widget).toContainText('NIFTYBEES');
  await widget.getByRole('link', { name: /Open market regime/ }).click();
  await expect(page.getByRole('region', { name: 'Current regime' })).toBeVisible();
});

test('training a Gaussian mixture sends the settings once and shows it training', async ({
  page,
}) => {
  const fake = await open(page, '/app/regime?tab=training');
  const form = page.getByRole('region', { name: 'Train a new model' });
  await form.getByRole('combobox', { name: 'Model type' }).selectOption('GMM');
  await expect(form.getByRole('combobox', { name: 'Reference instrument' })).toHaveValue(
    INSTRUMENTS_FIXTURE[1]!.id,
  );
  await expect(form.getByText(/600 daily bars in the range/)).toBeVisible();
  await form.getByRole('textbox', { name: 'Seed' }).fill('5');
  await form.getByRole('button', { name: 'Review training' }).click();
  await page.getByRole('button', { name: /Start training/ }).dblclick();
  await expect(
    form.getByText(/Model 2 \(gmm-regime-v1\) is training\. This page checks/),
  ).toBeVisible();
  expect(fake.trained).toEqual([
    {
      model_kind: 'GMM',
      instrument_id: INSTRUMENTS_FIXTURE[1]!.id,
      start_date: null,
      end_date: null,
      volatility_window: 20,
      trend_window: 20,
      candidate_components: [2, 3, 4],
      random_state: 5,
      horizon_days: 20,
    },
  ]);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

const evaluation = SUP_MODEL.card!.supervised!.evaluation;

test('a supervised model: dimensions now, band rows in history, accuracy against the target', async ({
  page,
}) => {
  await open(page, '/app/regime', { supervised: true });
  const card = page.getByRole('region', { name: 'Current regime' });
  await expect(card.getByTestId('regime-name')).toHaveText(SUP_CURRENT.regime.name);
  await expect(card).toContainText('Model classification of the next 20 days, not a guarantee');
  for (const d of SUP_CURRENT.dimensions!)
    await expect(card.getByRole('listitem', { name: d.name })).toContainText(
      `${d.label}${formatPercent(d.probability)}`,
    );
  const chart = page.getByRole('img', { name: /band rows/ });
  for (const band of SUP_HISTORY.dimension_periods!)
    await expect(chart.locator(`[data-dimension="${band.key}"] [data-band]`)).toHaveCount(
      band.periods.length,
    );
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await page.getByRole('tab', { name: 'Model card' }).click();
  const accuracy = page.getByRole('region', { name: 'Out-of-sample accuracy' });
  for (const d of evaluation.dimensions) {
    const tile = accuracy.getByRole('group', { name: `${d.name} accuracy` });
    await expect(tile).toContainText(formatPercent(d.test.accuracy));
    await expect(tile).toContainText(d.test.meets_target ? 'Meets target' : 'Below target');
  }
  const vol = evaluation.dimensions[0]!;
  const matrix = page.getByRole('table', { name: /Volatility confusion matrix/ });
  await expect(matrix.getByRole('row').nth(1).getByRole('cell').first()).toHaveText(
    String(vol.test.confusion_matrix[0]![0]),
  );
  await expect(page.getByRole('table', { name: 'Dataset splits and purge gaps' })).toContainText(
    'Purge gap',
  );
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test('training a supervised model sends the kind, horizon and India VIX once', async ({ page }) => {
  const fake = await open(page, '/app/regime?tab=training', { supervised: true });
  const form = page.getByRole('region', { name: 'Train a new model' });
  await expect(form.getByRole('combobox', { name: 'Model type' })).toHaveValue('AUTO');
  await expect(form.getByText(/828 labelled days/)).toBeVisible();
  await expect(form.getByRole('region', { name: 'What each dimension means' })).toBeVisible();
  await form.getByRole('combobox', { name: 'Model type' }).selectOption('XGB');
  await form.getByRole('textbox', { name: /Label horizon/ }).fill('15');
  await form.getByRole('combobox', { name: /India VIX/ }).selectOption(SUP_INSTRUMENTS[1]!.id);
  await form.getByRole('button', { name: 'Review training' }).click();
  await expect(page.getByRole('region', { name: 'Confirm training' })).toContainText(
    'XGBoost; next 15 days; India VIX INDIAVIX; seed 42',
  );
  await page.getByRole('button', { name: /Start training/ }).dblclick();
  await expect(form.getByText(/Model 2 \(supervised-regime-v1\) is training/)).toBeVisible();
  expect(fake.trained).toEqual([
    {
      model_kind: 'XGB',
      instrument_id: SUP_INSTRUMENTS[0]!.id,
      start_date: null,
      end_date: null,
      horizon_days: 15,
      vix_instrument_id: SUP_INSTRUMENTS[1]!.id,
      random_state: 42,
      volatility_window: 20,
      trend_window: 20,
    },
  ]);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});
