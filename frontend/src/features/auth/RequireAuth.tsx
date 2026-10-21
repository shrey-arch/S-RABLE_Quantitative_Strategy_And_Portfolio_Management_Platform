import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from './auth-context';

/**
 * Wraps every /app page. Logged-out visitors go to /login and come back
 * to the page they asked for after logging in.
 *
 * This only controls what the browser shows. The backend must (and does, for
 * these routes) reject requests without a valid token.
 */
export function RequireAuth() {
  const { state, endReason } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        className="flex min-h-dvh items-center justify-center gap-2 text-sm text-muted-foreground"
      >
        <Spinner /> Checking your session...
      </div>
    );
  }

  if (state.status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}`, reason: endReason ?? undefined }}
      />
    );
  }

  return <Outlet />;
}
