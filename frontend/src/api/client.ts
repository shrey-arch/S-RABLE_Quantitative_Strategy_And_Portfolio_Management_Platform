import createClient, { type Middleware } from 'openapi-fetch';
import { ApiError, networkError, toApiError } from './errors';
import type { paths } from './schema';
import { tokenStore } from './token';

/**
 * The single typed API client. Every request goes through here.
 *
 * Usage:
 *   const me = await unwrap(api.GET('/users/me'));
 *   const s  = await unwrap(api.GET('/strategies/{strategy_id}', {
 *     params: { path: { strategy_id: id } },
 *   }));
 *
 * Paths, parameters and bodies are checked against openapi.json at compile time.
 */

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/** Called when a protected request returns 401 (set by the auth layer in Phase 2). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = tokenStore.get();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
  onResponse({ request, response }) {
    // A 401 from login itself means wrong credentials, not an expired session.
    const isLogin = new URL(request.url).pathname.endsWith('/auth/login');
    if (response.status === 401 && !isLogin) {
      tokenStore.clear();
      onUnauthorized?.();
    }
    return response;
  },
};

export const api = createClient<paths>({ baseUrl });
api.use(authMiddleware);

/** Return the response data, or throw an ApiError with status + message (+ field errors). */
export async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  let result: Awaited<typeof request>;
  try {
    result = await request;
  } catch {
    throw networkError();
  }
  const { data, error, response } = result;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}

export { ApiError };
