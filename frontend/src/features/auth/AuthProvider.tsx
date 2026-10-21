import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError, api, setUnauthorizedHandler, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { getTokenExpiry, tokenStore } from '@/api/token';
import {
  AuthContext,
  type AuthState,
  type CurrentUser,
  type SessionEndReason,
} from './auth-context';
import { BACKEND_INACTIVE_MESSAGE } from './messages';

/**
 * Owns the login session:
 * - restores the session from sessionStorage on page load (checks the token with GET /users/me)
 * - logs in, then refuses accounts that are not ACTIVE
 * - ends the session at token expiry, on any 401, or on logout
 * - redirects to /login only once per session end (no redirect loops)
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [state, setState] = useState<AuthState>(() =>
    tokenStore.get() ? { status: 'loading', user: null } : { status: 'anonymous', user: null },
  );
  const [expiresAt, setExpiresAt] = useState<number | null>(() => getTokenExpiry(tokenStore.get()));
  const [endReason, setEndReason] = useState<SessionEndReason | null>(null);

  // Latest location, without making callbacks change on every navigation.
  const locationRef = useRef(location);
  locationRef.current = location;
  // Guards against several failing requests each triggering a redirect.
  const endingRef = useRef(false);
  // React (dev mode) runs mount effects twice; restore the session only once.
  const restoredRef = useRef(false);

  const endSession = useCallback(
    (reason: SessionEndReason | 'logout') => {
      if (reason !== 'logout' && endingRef.current) return;
      endingRef.current = true;

      tokenStore.clear();
      queryClient.clear();
      setExpiresAt(null);
      setEndReason(reason === 'logout' ? null : reason);
      setState({ status: 'anonymous', user: null });

      const here = locationRef.current;
      const from = `${here.pathname}${here.search}`;
      if (reason === 'logout') {
        navigate('/login', { replace: true });
      } else if (here.pathname !== '/login') {
        navigate('/login', { replace: true, state: { reason, from } });
      }
    },
    [navigate, queryClient],
  );

  /** Loads the current user; ends the session if the account is not ACTIVE. */
  const loadUser = useCallback(async (): Promise<CurrentUser> => {
    const user = await unwrap(api.GET('/users/me'));
    if (user.account_status !== 'ACTIVE') {
      endSession('inactive');
      throw new ApiError(401, BACKEND_INACTIVE_MESSAGE);
    }
    queryClient.setQueryData(queryKeys.me, user);
    setState({ status: 'authenticated', user });
    return user;
  }, [endSession, queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { access_token } = await unwrap(api.POST('/auth/login', { body: { email, password } }));
      tokenStore.set(access_token);
      endingRef.current = false;
      setEndReason(null);
      setExpiresAt(getTokenExpiry(access_token));
      return loadUser();
    },
    [loadUser],
  );

  const logout = useCallback(() => endSession('logout'), [endSession]);

  const updateUser = useCallback(
    (user: CurrentUser) => {
      queryClient.setQueryData(queryKeys.me, user);
      setState((prev) =>
        prev.status === 'authenticated' ? { status: 'authenticated', user } : prev,
      );
    },
    [queryClient],
  );

  // Restore an existing session once on page load.
  useEffect(() => {
    if (restoredRef.current || !tokenStore.get()) return;
    restoredRef.current = true;
    const expiry = getTokenExpiry(tokenStore.get());
    if (expiry !== null && expiry <= Date.now()) {
      endSession('expired');
      return;
    }
    loadUser().catch((error: unknown) => {
      // 401 is already handled by the client (redirect once). Anything else: start logged out.
      if (!(error instanceof ApiError && error.status === 401)) {
        tokenStore.clear();
        setState({ status: 'anonymous', user: null });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Any request that carried a token and got 401 ends the session.
  useEffect(() => {
    setUnauthorizedHandler(() => endSession('expired'));
    return () => setUnauthorizedHandler(null);
  }, [endSession]);

  // Log out automatically when the token expires (backend tokens last 30 minutes).
  useEffect(() => {
    if (state.status !== 'authenticated' || expiresAt === null) return;
    const timer = window.setTimeout(
      () => endSession('expired'),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [state.status, expiresAt, endSession]);

  const value = useMemo(
    () => ({ state, login, logout, expiresAt, endReason, updateUser }),
    [state, login, logout, expiresAt, endReason, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
