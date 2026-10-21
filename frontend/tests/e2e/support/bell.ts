import type { Page } from '@playwright/test';

/**
 * Phase 16: every /app page shows the notification bell, which asks
 * GET /notifications/unread-count. Tests that answer the API themselves call this
 * first, so the bell gets "0 unread" instead of reaching a real backend with the
 * stand-in token. A test that registers its own answer later takes precedence.
 */
export async function quietBell(page: Page, unread = 0) {
  await page.route(
    (url) => url.pathname === '/notifications/unread-count',
    (route) =>
      route.request().resourceType() === 'fetch'
        ? route.fulfill({ json: { unread } })
        : route.continue(),
  );
}
