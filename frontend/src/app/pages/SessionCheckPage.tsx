import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ApiError, api, unwrap } from '@/api/client';
import { tokenStore } from '@/api/token';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { DateText } from '@/components/ui/value-text';
import { useAuth } from '@/features/auth/auth-context';
import { loginErrorMessage } from '@/features/auth/messages';

/**
 * Developer page (/dev/session): exercises the session core against the REAL backend
 * before the Login and Register pages exist. Never shows the token itself.
 */
export default function SessionCheckPage() {
  const { state, login, logout, expiresAt } = useAuth();
  const [fullName, setFullName] = useState('Test User');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const register = async () => {
    setBusy(true);
    try {
      await unwrap(api.POST('/auth/register', { body: { full_name: fullName, email, password } }));
      toast.success('Registered. Now log in.');
    } catch (e) {
      toast.error(e instanceof ApiError ? `${e.status}: ${e.message}` : 'Register failed');
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async () => {
    setBusy(true);
    try {
      await login(email, password);
      toast.success('Logged in');
    } catch (e) {
      toast.error(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Replace the token with an invalid one, then make a protected call: the backend
  // answers 401 and the app must redirect to /login exactly once.
  const simulateExpiry = () => {
    tokenStore.set('invalid.token.value');
    void unwrap(api.GET('/users/me')).catch(() => undefined);
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="page-title text-3xl">Session check</h1>
        <p className="text-sm text-muted-foreground">Developer | uses the real backend</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Current session</CardTitle>
          <CardDescription>The token itself is never displayed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Status: <strong data-testid="session-status">{state.status}</strong>
          </p>
          {state.status === 'authenticated' && (
            <>
              <p>
                User: {state.user.full_name} ({state.user.email})
              </p>
              <p className="flex items-center gap-2">
                Account: <StatusBadge kind="account" value={state.user.account_status} />
              </p>
              <p>
                Token expires:{' '}
                <DateText value={expiresAt ? new Date(expiresAt).toISOString() : null} withTime />
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" onClick={logout} disabled={state.status !== 'authenticated'}>
              Log out
            </Button>
            <Button
              variant="outline"
              onClick={simulateExpiry}
              disabled={state.status !== 'authenticated'}
            >
              Simulate expired token
            </Button>
            <Button variant="link" asChild>
              <Link to="/app/dashboard">Open a protected page</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Register / log in</CardTitle>
          <CardDescription>
            Temporary test form. The real pages come in Steps 2.2 and 2.3.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Full name (register only)</Label>
            <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (8+ characters)</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="outline" disabled={busy} onClick={register}>
              Register
            </Button>
            <Button disabled={busy} onClick={doLogin}>
              Log in
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
