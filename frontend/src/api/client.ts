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

/** Called when a request sent WITH a token comes back 401 (set by the auth layer). */
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
    // Only a 401 on a request that carried a token means "session ended".
    // A 401 from login (wrong password) or from an anonymous request is not a session event.
    const sentToken = request.headers.has('Authorization');
    const isLogin = new URL(request.url).pathname.endsWith('/auth/login');
    if (response.status === 401 && sentToken && !isLogin) {
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
