import type { APIRequestContext } from '@playwright/test';

/**
 * Is the real backend up? Asked once per spec file, before anything runs.
 *
 * Patience matters here more than it looks. A spec file that decides the backend
 * is down skips **every test in it**, quietly, and the run still ends green - so
 * a check that is too impatient does not fail, it hides. That is what a 3-second
 * timeout did: FastAPI builds the whole OpenAPI schema on the first request for
 * it (measured: 1.1 s cold against 5 ms once cached, on an idle machine), and at
 * the start of a run eight workers are launching browsers while the first spec
 * files ask at once. The files that happened to start first - account, auth,
 * backtests, alphabetically - timed out and skipped, taking the Feature 2, 3, 4
 * and 5 gates with them, while files that started later found a warm schema and
 * ran. Sixteen real tests disappeared from a "passing" run.
 *
 * So: a generous timeout, and more than one attempt. A backend that is genuinely
 * not running still answers at once (connection refused), so nothing waits the
 * full time for the ordinary "I did not start uvicorn" case.
 */
export async function backendIsUp(
  request: APIRequestContext,
  backend: string,
  attempts = 3,
): Promise<boolean> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ok = await request
      .get(`${backend}/openapi.json`, { timeout: 30_000 })
      .then((response) => response.ok())
      .catch(() => false);
    if (ok) return true;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}
