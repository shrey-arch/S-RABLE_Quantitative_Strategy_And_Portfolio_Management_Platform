/**
 * Holds the bearer access token returned by POST /auth/login.
 *
 * Memory only for now: never in URLs, logs or localStorage.
 * Phase 2 decides whether the session should survive a page refresh.
 */
let accessToken: string | null = null;

export const tokenStore = {
  get: (): string | null => accessToken,
  set: (token: string | null): void => {
    accessToken = token;
  },
  clear: (): void => {
    accessToken = null;
  },
};
