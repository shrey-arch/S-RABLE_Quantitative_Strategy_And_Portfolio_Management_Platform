import { Outlet } from 'react-router';
import { AuthProvider } from '@/features/auth/AuthProvider';

/** Root route element: gives every page access to the login session. */
export function AuthRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}
