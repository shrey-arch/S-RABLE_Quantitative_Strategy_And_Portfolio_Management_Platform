/**
 * Backend route prefixes (first part of every path in openapi.json).
 * In development, Vite forwards requests to these to FastAPI, so the browser
 * only ever talks to one origin. api-prefixes.test.ts fails if the backend
 * adds a path whose prefix is missing here.
 */
export const API_PREFIXES = [
  '/auth',
  '/users',
  '/brokers',
  '/strategies',
  '/strategy-registry',
  '/instruments',
  '/indicators',
  '/executions',
  '/backtests',
  '/validations',
  '/regime',
  '/scoring',
  '/orders',
  '/trades',
  '/positions',
  '/portfolio',
  '/portfolio-backtests',
  '/notifications',
  '/paper',
  '/live',
  '/sandbox',
];
