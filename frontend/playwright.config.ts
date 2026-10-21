import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests (end-to-end). They start the Vite dev server automatically.
 * Phase 1 tests need no backend. Later phases add journeys that need the
 * FastAPI backend running on port 8000.
 *
 * First time only:  npx playwright install chromium
 * Run:              npm run test:e2e
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH; // optional override for custom environments

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // A page's first visit makes Vite compile it; on slower machines that can take
  // more than the default 5 s, so checks wait up to 10 s.
  expect: { timeout: 10_000 },
  // Each test may take up to 60 s: with many workers on a laptop, the first visit
  // to a page (Vite compiling it) can use most of the default 30 s by itself.
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
