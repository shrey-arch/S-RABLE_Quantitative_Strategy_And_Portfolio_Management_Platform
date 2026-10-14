/**
 * One error shape for every failed request.
 *
 * The backend (FastAPI) returns errors as:
 *   { "detail": "Not authenticated" }                         → 401, 404, 409, …
 *   { "detail": [{ "loc": ["body","email"], "msg": "…" }] }   → 422 validation
 */

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: FieldErrors;

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /** Backend could not be reached (server down, network error). */
  get isNetworkError() {
    return this.status === 0;
  }
  get isUnauthorized() {
    return this.status === 401;
  }
  /** 404 means "missing" or "not yours" — the UI never says which. */
  get isNotFound() {
    return this.status === 404;
  }
  get isValidation() {
    return this.status === 422;
  }
}

const DEFAULT_MESSAGES: Record<number, string> = {
  0: 'Cannot reach the server. Check that the backend is running.',
  401: 'Your session has ended. Please log in again.',
  403: 'You do not have access to this.',
  404: 'Not found or not available to you.',
  409: 'This conflicts with an existing record.',
  422: 'Some fields are invalid.',
};

/** ["body", "strategy_config", "indicators", 0, "name"] → "strategy_config.indicators.0.name" */
function fieldName(loc: unknown): string {
  if (!Array.isArray(loc)) return 'form';
  const parts = loc.slice(loc[0] === 'body' || loc[0] === 'query' || loc[0] === 'path' ? 1 : 0);
  return parts.length ? parts.join('.') : 'form';
}

export function toApiError(status: number, body: unknown): ApiError {
  const detail =
    typeof body === 'object' && body !== null ? (body as { detail?: unknown }).detail : undefined;

  // 422 — list of field problems
  if (Array.isArray(detail)) {
    const fieldErrors: FieldErrors = {};
    for (const item of detail) {
      const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown };
      const key = fieldName(loc);
      const text = typeof msg === 'string' ? msg : 'Invalid value';
      fieldErrors[key] = fieldErrors[key] ? `${fieldErrors[key]}; ${text}` : text;
    }
    return new ApiError(status, DEFAULT_MESSAGES[422]!, fieldErrors);
  }

  // Never show server internals for 5xx; never reveal ownership for 404.
  if (status >= 500) return new ApiError(status, 'The server had a problem. Please try again.');
  if (status === 404) return new ApiError(status, DEFAULT_MESSAGES[404]!);

  const message =
    typeof detail === 'string' && detail.trim()
      ? detail
      : (DEFAULT_MESSAGES[status] ?? `Request failed (${status}).`);
  return new ApiError(status, message);
}

export function networkError(): ApiError {
  return new ApiError(0, DEFAULT_MESSAGES[0]!);
}
