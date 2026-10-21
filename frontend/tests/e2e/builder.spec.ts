import { expect, test, type Page } from '@playwright/test';
import { quietBell } from './support/bell';
import { INDICATORS_FIXTURE } from '../../src/features/indicators/indicator-fixture';
import { REGISTRY_FIXTURE } from '../../src/features/strategies/registry-fixture';
import {
  SBX_INSTRUMENTS,
  SBX_REFERENCE,
  SBX_REFUSED,
  SBX_TEST_RUN,
} from '../../src/features/builder/python/sandbox-fixture';

/**
 * Phase 8: the no-code builder in a real browser. A small in-memory fake of the
 * strategy and indicator API answers fetch requests, so a saved strategy survives a
 * reload. The real-backend round trip is in builder.real.spec.ts.
 */

const USER = {
  id: 'u-1',
  full_name: 'Builder Test',
  email: 'b@example.com',
  account_status: 'ACTIVE',
};

/** Like POST /indicators/{key}/validate: fills in defaults. */
function fakeValidate(key: string, parameters: Record<string, number>) {
  const spec = INDICATORS_FIXTURE.find((i) => i.key === key)!;
  const values: Record<string, number> = {};
  for (const p of spec.parameters) {
    const v = parameters[p.name] ?? p.default;
    if (v === null || v === undefined) return { error: `${key} needs ${p.name}.` };
    values[p.name] = v;
  }
  return { key, parameters: values };
}

async function openApp(page: Page) {
  const store = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  await page.route(
    (url) =>
      url.pathname === '/users/me' ||
      url.pathname.startsWith('/indicators') ||
      url.pathname === '/strategy-registry' ||
      url.pathname === '/instruments' ||
      url.pathname === '/sandbox/reference' ||
      url.pathname.startsWith('/strategies'),
    async (route) => {
      const request = route.request();
      if (request.resourceType() !== 'fetch') return route.continue();
      const path = new URL(request.url()).pathname;
      if (path === '/users/me') return route.fulfill({ json: USER });
      if (path === '/indicators') return route.fulfill({ json: INDICATORS_FIXTURE });
      // Every call the pages make is answered here, so a running backend never sees the
      // stand-in token (its 401 would log the test out).
      if (path === '/strategy-registry') return route.fulfill({ json: REGISTRY_FIXTURE });
      // Feature 6: the sandbox reference and the instruments the test run offers.
      if (path === '/sandbox/reference') return route.fulfill({ json: SBX_REFERENCE });
      if (path === '/instruments') return route.fulfill({ json: SBX_INSTRUMENTS });
      if (path.endsWith('/test-run')) {
        const strategyId = path.split('/')[2]!;
        const item = store.get(strategyId) as { python_code?: string } | undefined;
        if (item?.python_code?.includes('import os')) {
          return route.fulfill({ status: 422, json: { detail: SBX_REFUSED } });
        }
        return route.fulfill({ json: SBX_TEST_RUN });
      }
      if (path.endsWith('/validate')) {
        const { parameters } = request.postDataJSON() as { parameters: Record<string, number> };
        const result = fakeValidate(path.split('/')[2]!, parameters);
        return 'error' in result
          ? route.fulfill({ status: 422, json: { detail: result.error } })
          : route.fulfill({ json: result });
      }
      if (path === '/strategies' && request.method() === 'POST') {
        const body = request.postDataJSON() as Record<string, unknown>;
        const created = {
          python_code: null,
          ...body,
          id: `new-${nextId++}`,
          user_id: USER.id,
          version: 1,
          is_active: true,
          created_at: '2026-10-16T10:00:00+00:00',
          updated_at: '2026-10-16T10:00:00+00:00',
        };
        store.set(created.id, created);
        return route.fulfill({ status: 201, json: created });
      }
      if (path === '/strategies') return route.fulfill({ json: [...store.values()] });
      const item = store.get(path.split('/')[2] ?? '');
      if (!item) return route.fulfill({ status: 404, json: { detail: 'Strategy not found.' } });
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as Record<string, unknown>;
        const changed =
          (body.strategy_config !== undefined &&
            JSON.stringify(body.strategy_config) !== JSON.stringify(item.strategy_config)) ||
          (body.python_code !== undefined && body.python_code !== item.python_code);
        Object.assign(item, body, { version: (item.version as number) + (changed ? 1 : 0) });
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
  return store;
}

const next = (page: Page) => page.getByRole('button', { name: /Next/ }).click();
const step = (page: Page, title: string) =>
  expect(page.getByRole('heading', { level: 2, name: new RegExp(`: ${title}$`) })).toBeVisible();

test('build, save, reload and edit a no-code strategy', async ({ page }) => {
  const store = await openApp(page);
  await page.goto('/app/strategies');
  await page.getByRole('link', { name: /Build without code/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Strategy Builder' })).toBeVisible();

  await page.getByRole('textbox', { name: 'Name' }).fill('MACD cross');
  await next(page);
  await step(page, 'Parameters');
  await next(page);

  await step(page, 'Indicators');
  await page.getByRole('button', { name: /Add indicator/ }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('macd');
  await page.getByLabel('Type', { exact: true }).selectOption('MACD');
  await page.getByRole('button', { name: 'Add indicator' }).click();
  await expect(page.getByRole('list', { name: 'Indicators in this strategy' })).toContainText(
    'fast_period=12, slow_period=26, signal_period=9',
  );
  await next(page);

  // MACD has three lines: the builder asks which one.
  await step(page, 'Entry conditions');
  await page.getByRole('button', { name: /Add entry condition/ }).click();
  await page.getByRole('combobox', { name: 'Entry condition 1 operator' }).selectOption('>');
  await page
    .getByRole('combobox', { name: 'Entry condition 1 right kind' })
    .selectOption('indicator');
  await page.getByRole('combobox', { name: 'Entry condition 1 right line' }).selectOption('signal');
  await next(page);
  await step(page, 'Exit conditions');
  await next(page);

  await step(page, 'Review');
  await expect(page.getByText('Enter when macd.macd > macd.signal.')).toBeVisible();
  const json = JSON.parse((await page.getByLabel('Configuration JSON').textContent()) ?? '');

  const posted = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/strategies'),
  );
  await page.getByRole('button', { name: /Create strategy/ }).click();
  const body = (await posted).postDataJSON() as { strategy_config: unknown };
  expect(body.strategy_config).toEqual(json);

  // The strategy page shows the saved copy, and offers a backtest of its rules.
  await expect(page.getByRole('heading', { level: 1, name: 'MACD cross' })).toBeVisible();
  await expect(page.getByText('macd.macd > macd.signal')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Backtest', exact: true })).toHaveAttribute(
    'href',
    /\/app\/backtests\/new\?strategy=/,
  );
  await page.reload();
  await expect(page.getByText('macd.macd > macd.signal')).toBeVisible();

  // Edit: the builder opens with the saved values; a changed rule saves a new version.
  await page.getByRole('link', { name: /Edit/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit strategy' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('MACD cross');
  await page
    .getByRole('navigation', { name: 'Builder steps' })
    .getByRole('button', { name: /Entry conditions/ })
    .click();
  await page.getByRole('combobox', { name: 'Entry condition 1 operator' }).selectOption('>=');
  await page
    .getByRole('navigation', { name: 'Builder steps' })
    .getByRole('button', { name: /Review/ })
    .click();
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.getByText('macd.macd >= macd.signal')).toBeVisible();
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  expect([...store.values()][0]!.strategy_config).toEqual({
    ...json,
    entry_conditions: [{ ...json.entry_conditions[0], operator: '>=' }],
  });
});

test('an invalid reference is refused in the browser and nothing is saved', async ({ page }) => {
  const store = await openApp(page);
  await page.goto('/app/builder/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Broken');
  const nav = page.getByRole('navigation', { name: 'Builder steps' });
  await nav.getByRole('button', { name: /Indicators/ }).click();
  await page.getByRole('button', { name: /Add indicator/ }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('sma_20');
  await page.getByRole('textbox', { name: /window/ }).fill('20');
  await page.getByRole('button', { name: 'Add indicator' }).click();
  await nav.getByRole('button', { name: /Entry conditions/ }).click();
  await page.getByRole('button', { name: /Add entry condition/ }).click();
  await page.getByRole('textbox', { name: 'Entry condition 1 right number' }).fill('100');
  // Remove the indicator the condition uses.
  await nav.getByRole('button', { name: /Indicators/ }).click();
  await page.getByRole('button', { name: 'Remove sma_20' }).click();
  await nav.getByRole('button', { name: /Review/ }).click();
  await page.getByRole('button', { name: /Create strategy/ }).click();
  await expect(page.getByRole('alert').first()).toContainText('sma_20 is not defined');
  await expect(nav.getByRole('button', { name: /Entry conditions/ })).toContainText('1');
  expect(store.size).toBe(0);
});

test('write, save, test-run and edit a Python strategy', async ({ page }) => {
  const store = await openApp(page);
  await page.goto('/app/strategies');
  await page.getByRole('link', { name: /Write Python/ }).click();
  await expect(page).toHaveURL(/\/app\/builder\/new\?type=python$/);

  // A real code editor with Python highlighting, starting from the contract template.
  const editor = page.getByRole('textbox', { name: 'Python code' });
  await expect(editor).toContainText('def generate_signal(context):');
  await expect(page.locator('.cm-editor .cm-lineNumbers')).toBeVisible();
  await expect(page.getByTestId('code-editor').getByText('def', { exact: true }).first()).toHaveCSS(
    'color',
    /rgb/,
  );

  // Feature 6: the sandbox is named, and a test run needs a saved strategy first.
  await expect(page.getByText(/runs in an isolated sandbox/)).toBeVisible();
  await expect(page.getByText('Save the strategy to test it')).toBeVisible();
  expect(store.size).toBe(0);

  // The reference panel is the backend's own, including the limits it enforces.
  await page.getByRole('tab', { name: /What the code can use/ }).click();
  const reference = page.getByRole('tabpanel', { name: /What the code can use/ });
  await expect(reference.getByRole('region', { name: 'What the code is given' })).toBeVisible();
  await expect(reference).toContainText('context.history(field, n)');
  for (const rule of SBX_REFERENCE.rules) await expect(reference).toContainText(rule);

  await page.getByRole('textbox', { name: 'Name' }).fill('Python breakout');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n# tuned');
  const posted = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().endsWith('/strategies'),
  );
  await page.getByRole('button', { name: /Create strategy/ }).click();
  const body = (await posted).postDataJSON() as Record<string, unknown>;
  expect(body.strategy_type).toBe('PYTHON');
  expect(body.python_code).toContain('def generate_signal(context):');
  expect(body.python_code).toContain('# tuned');

  // The strategy page shows the saved code and offers a backtest.
  await expect(page.getByRole('heading', { level: 1, name: 'Python breakout' })).toBeVisible();
  await expect(page.getByLabel('Saved Python code')).toContainText('# tuned');
  await expect(page.getByRole('link', { name: 'Backtest', exact: true })).toBeVisible();
  await expect(
    page.getByText(/cannot be deployed to the paper account or run live yet/),
  ).toBeVisible();

  // Back in the editor, a test run shows the signals the sandbox produced.
  await page.getByRole('link', { name: /Edit/ }).click();
  await page.getByLabel('Instrument').selectOption(SBX_INSTRUMENTS[0]!.id);
  await page.getByRole('button', { name: /Test run/ }).click();
  const changes = SBX_TEST_RUN.signals.filter((signal) => signal.changed).length;
  await expect(page.getByTestId('test-run-summary')).toContainText(
    `${SBX_TEST_RUN.signals.length} bars`,
  );
  await expect(page.getByTestId('test-run-summary')).toContainText(`${changes} position changes`);
  await expect(page.getByTestId('sandbox-kind')).toBeVisible();
  await expect(page.getByRole('img', { name: /test run/ })).toHaveAttribute(
    'data-marker-count',
    String(changes),
  );
  await expect(page.getByRole('list', { name: 'Signals and logs' })).toContainText('average=');
  await expect(page.getByText(/not stored/)).toBeVisible();

  // Editing the code saves a new version (we are already in the editor).
  await expect(page.getByRole('textbox', { name: 'Python code' })).toContainText(
    'def generate_signal(context):',
  );
  await page.getByRole('textbox', { name: 'Python code' }).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n# v2');
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Saved Python code')).toContainText('# v2');
});
