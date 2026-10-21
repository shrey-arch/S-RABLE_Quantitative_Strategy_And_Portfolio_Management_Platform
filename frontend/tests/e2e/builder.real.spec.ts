import { expect, test, type Page } from '@playwright/test';
import { backendIsUp } from './support/backend';

/**
 * Phase 8 gate against the REAL backend: a strategy built in the no-code builder
 * round-trips through the Strategy API without loss, and Python code is saved and
 * versioned (never run). What the browser sends must equal the copy the backend
 * stores and returns, before and after an edit.
 * Skipped automatically when the backend is not running on localhost:8000.
 *
 * Each run registers a new user named e2e-<time>@example.com in the database.
 * Clean up any time with:  DELETE FROM users WHERE email LIKE 'e2e-%@example.com';
 */

const BACKEND = process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:8000';
const PASSWORD = 'E2e-test-pass-123';
const BACKEND_WAIT = { timeout: 20_000 };

test.beforeAll(async ({ request }) => {
  const up = await backendIsUp(request, BACKEND);
  test.skip(!up, `Backend not reachable at ${BACKEND}; start uvicorn to run these.`);
});

test.skip(({ isMobile }) => isMobile, 'Real-API journeys run on desktop only');
test.describe.configure({ timeout: 120_000 });

async function registerAndLogIn(page: Page) {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('E2E Builder');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/login$/, BACKEND_WAIT);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/, BACKEND_WAIT);
}

interface StoredStrategy {
  strategy_type: string;
  strategy_config: unknown;
  python_code: string | null;
  version: number;
}

/** GET /strategies/{id} straight from the backend, with the browser's session token. */
async function backendStrategy(page: Page, id: string): Promise<StoredStrategy> {
  const token = await page.evaluate(() => sessionStorage.getItem('srable.session'));
  const response = await page.request.get(`${BACKEND}/strategies/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as StoredStrategy;
}
const backendCopy = backendStrategy;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Builder steps' });

async function addIndicator(page: Page, name: string, type: string, window?: string) {
  await page.getByRole('button', { name: /Add indicator/ }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill(name);
  await page.getByLabel('Type', { exact: true }).selectOption(type);
  if (window) await page.getByRole('textbox', { name: /window/ }).fill(window);
  await page.getByRole('button', { name: 'Add indicator' }).click();
  await expect(page.getByRole('list', { name: 'Indicators in this strategy' })).toContainText(
    name,
    BACKEND_WAIT,
  );
}

test('a no-code strategy round-trips through the real Strategy API without loss', async ({
  page,
}) => {
  await registerAndLogIn(page);
  await page.goto('/app/builder/new');
  await page.getByRole('textbox', { name: 'Name' }).fill('Gate: SMA and MACD');
  await page.getByRole('textbox', { name: 'Description' }).fill('Phase 8 gate');

  await nav(page)
    .getByRole('button', { name: /Parameters/ })
    .click();
  await page.getByRole('button', { name: /Add parameter/ }).click();
  await page.getByRole('textbox', { name: 'Parameter 1 name' }).fill('quantity');
  await page.getByRole('textbox', { name: 'Parameter 1 value' }).fill('10');
  await page.getByRole('button', { name: /Add parameter/ }).click();
  await page.getByRole('textbox', { name: 'Parameter 2 name' }).fill('risk');
  await page.getByRole('combobox', { name: 'Parameter 2 type' }).selectOption('float');
  await page.getByRole('textbox', { name: 'Parameter 2 value' }).fill('1.5');

  await nav(page)
    .getByRole('button', { name: /Indicators/ })
    .click();
  await addIndicator(page, 'sma_20', 'SMA', '20');
  await addIndicator(page, 'macd', 'MACD');

  // Entry: sma_20 < close, and macd.macd > macd.signal
  await nav(page)
    .getByRole('button', { name: /Entry conditions/ })
    .click();
  await page.getByRole('button', { name: /Add entry condition/ }).click();
  await page.getByRole('combobox', { name: 'Entry condition 1 right kind' }).selectOption('price');
  await page.getByRole('button', { name: /Add entry condition/ }).click();
  await page
    .getByRole('combobox', { name: 'Entry condition 2 left indicator' })
    .selectOption('macd');
  await page.getByRole('combobox', { name: 'Entry condition 2 operator' }).selectOption('>');
  await page
    .getByRole('combobox', { name: 'Entry condition 2 right kind' })
    .selectOption('indicator');
  await page
    .getByRole('combobox', { name: 'Entry condition 2 right indicator' })
    .selectOption('macd');
  await page.getByRole('combobox', { name: 'Entry condition 2 right line' }).selectOption('signal');

  // Exit: close <= 95.5
  await nav(page)
    .getByRole('button', { name: /Exit conditions/ })
    .click();
  await page.getByRole('button', { name: /Add exit condition/ }).click();
  await page.getByRole('combobox', { name: 'Exit condition 1 left kind' }).selectOption('price');
  await page.getByRole('combobox', { name: 'Exit condition 1 operator' }).selectOption('<=');
  await page.getByRole('textbox', { name: 'Exit condition 1 right number' }).fill('95.5');

  await nav(page)
    .getByRole('button', { name: /Review/ })
    .click();
  await expect(
    page.getByText('Enter when sma_20 < close and macd.macd > macd.signal.'),
  ).toBeVisible();
  const shown = JSON.parse((await page.getByLabel('Configuration JSON').textContent()) ?? '');

  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/strategies'),
  );
  await page.getByRole('button', { name: /Create strategy/ }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const sent = (response.request().postDataJSON() as { strategy_config: unknown }).strategy_config;
  const saved = (await response.json()) as { id: string };

  // What the Review step showed = what was sent = what the backend stores.
  expect(sent).toEqual(shown);
  const stored = await backendCopy(page, saved.id);
  expect(stored.strategy_config).toEqual(sent);
  expect(stored.version).toBe(1);

  // Reload, edit in the builder, save: still lossless, and a new version.
  await expect(page.getByRole('heading', { level: 1, name: 'Gate: SMA and MACD' })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: /Edit/ }).click();
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Gate: SMA and MACD');
  await nav(page)
    .getByRole('button', { name: /Exit conditions/ })
    .click();
  await page.getByRole('combobox', { name: 'Exit condition 1 operator' }).selectOption('<');
  await nav(page)
    .getByRole('button', { name: /Review/ })
    .click();
  const edited = JSON.parse((await page.getByLabel('Configuration JSON').textContent()) ?? '');
  expect(edited).toEqual({
    ...shown,
    exit_conditions: [{ ...shown.exit_conditions[0], operator: '<' }],
  });
  const patched = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await page.getByRole('button', { name: /Save changes/ }).click();
  expect((await patched).status()).toBe(200);
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
  const after = await backendCopy(page, saved.id);
  expect(after.strategy_config).toEqual(edited);
  expect(after.version).toBe(2);
});

test('the backend refuses a reference the browser did not check (422)', async ({ page }) => {
  await registerAndLogIn(page);
  const token = await page.evaluate(() => sessionStorage.getItem('srable.session'));
  const response = await page.request.post(`${BACKEND}/strategies`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: 'Bad reference',
      strategy_type: 'NO_CODE',
      strategy_config: {
        parameters: {},
        indicators: [],
        entry_conditions: [
          {
            left: { type: 'indicator', name: 'sma_20' },
            operator: '<',
            right: { type: 'price', field: 'close' },
          },
        ],
        exit_conditions: [],
      },
    },
  });
  expect(response.status()).toBe(422);
  expect(await response.text()).toContain('Unknown indicator reference: sma_20');
});

test('a Python strategy is saved, versioned and refused with the syntax error', async ({
  page,
}) => {
  await registerAndLogIn(page);
  await page.goto('/app/builder/new?type=python');
  await page.getByRole('textbox', { name: 'Name' }).fill('Gate: Python template');
  const editor = page.getByRole('textbox', { name: 'Python code' });
  await expect(editor).toContainText('def generate_signal(context):');

  // The template as shipped is accepted by the backend check.
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/strategies'),
  );
  await page.getByRole('button', { name: /Create strategy/ }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const sent = response.request().postDataJSON() as { python_code: string };
  const saved = (await response.json()) as { id: string };
  const stored = await backendStrategy(page, saved.id);
  expect(stored.python_code).toBe(sent.python_code);
  expect(stored.strategy_type).toBe('PYTHON');
  expect(stored.version).toBe(1);

  // A syntax error is refused with the backend's reason; nothing changes.
  await page.getByRole('link', { name: /Edit/ }).click();
  // insertText replaces the text as one paste, without auto-indent or bracket closing.
  await page.getByRole('textbox', { name: 'Python code' }).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('def generate_signal(:\n');
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.getByRole('alert')).toContainText('Python syntax error on line', BACKEND_WAIT);
  expect((await backendStrategy(page, saved.id)).version).toBe(1);

  // Fixing it saves version 2 with exactly the code in the editor.
  await page.getByRole('textbox', { name: 'Python code' }).click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(`${sent.python_code}# tuned\n`);
  await page.getByRole('button', { name: /Save changes/ }).click();
  await expect(page.getByText('Version 2', { exact: true })).toBeVisible(BACKEND_WAIT);
  const after = await backendStrategy(page, saved.id);
  expect(after.version).toBe(2);
  expect(after.python_code).toBe(`${sent.python_code}# tuned\n`);
});
