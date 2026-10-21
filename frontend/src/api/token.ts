/**
 * Holds the bearer access token returned by POST /auth/login.
 *
 * Phase 2 decision: kept in sessionStorage, so the session survives a page refresh
 * but ends when the browser tab is closed. Never put in URLs, logs or localStorage.
 *
 * The backend token is a JWT that expires 30 minutes after login (no refresh token).
 */
const STORAGE_KEY = 'srable.session';

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: fall back to memory only
  }
}

let accessToken: string | null = readStored();

export const tokenStore = {
  get: (): string | null => accessToken,
  set: (token: string | null): void => {
    accessToken = token;
    try {
      if (token) sessionStorage.setItem(STORAGE_KEY, token);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage blocked: token still works for this page view
    }
  },
  clear: (): void => {
    tokenStore.set(null);
  },
};

/**
 * Expiry time (ms since epoch) from the token's "exp" claim, or null if unreadable.
 * Used only to log the user out on time - the backend still validates every request.
 */
export function getTokenExpiry(token: string | null): number | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}
