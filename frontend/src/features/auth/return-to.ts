/**
 * Where to send the user after logging in.
 * Only pages inside the app are allowed, so a crafted link can never redirect
 * the user to another site.
 */
export const DEFAULT_AFTER_LOGIN = '/app/dashboard';

export function safeReturnTo(from: unknown): string {
  if (typeof from !== 'string') return DEFAULT_AFTER_LOGIN;
  if (!from.startsWith('/app') || from.startsWith('//')) return DEFAULT_AFTER_LOGIN;
  return from;
}
