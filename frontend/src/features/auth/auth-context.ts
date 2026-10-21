import { createContext, useContext } from 'react';
import type { components } from '@/api/schema';

/**
 * GET /users/me and PATCH /users/me both return UserProfileResponse.
 */
export type CurrentUser = components['schemas']['UserProfileResponse'];

/** Why the user was sent to the login page (shown as a message there). */
export type SessionEndReason = 'expired' | 'inactive';

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: CurrentUser };

export interface AuthContextValue {
  state: AuthState;
  /** Logs in, loads the user and checks the account is ACTIVE. Throws ApiError on failure. */
  login: (email: string, password: string) => Promise<CurrentUser>;
  /** Ends the session in this browser (the backend has no logout endpoint). */
  logout: () => void;
  /** Token expiry time (ms since epoch), for display only. */
  expiresAt: number | null;
  /** Why the last session ended (shown on the login page); null after a normal logout or login. */
  endReason: SessionEndReason | null;
  /** Replaces the logged-in user after the profile is saved (PATCH /users/me). */
  updateUser: (user: CurrentUser) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
