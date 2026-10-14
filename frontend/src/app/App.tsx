import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, unwrap } from '@/api/client';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

type CheckResult = { ok: boolean; text: string } | null;

/** Temporary Step 1.5 check page: proves real typed calls reach the backend. */
export default function App() {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [publicCheck, setPublicCheck] = useState<CheckResult>(null);
  const [protectedCheck, setProtectedCheck] = useState<CheckResult>(null);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  // Public route: should succeed and return the instrument list.
  const checkPublic = async () => {
    try {
      const instruments = await unwrap(api.GET('/instruments'));
      setPublicCheck({ ok: true, text: `200 OK — ${instruments.length} instrument(s) returned` });
    } catch (e) {
      setPublicCheck({
        ok: false,
        text: e instanceof ApiError ? `${e.status} — ${e.message}` : String(e),
      });
    }
  };

  // Protected route without a token: should be rejected with 401.
  const checkProtected = async () => {
    try {
      await unwrap(api.GET('/users/me'));
      setProtectedCheck({ ok: false, text: 'Unexpected: returned data without a token' });
    } catch (e) {
      const ok = e instanceof ApiError && e.status === 401;
      setProtectedCheck({
        ok,
        text: e instanceof ApiError ? `${e.status} — ${e.message}` : String(e),
      });
    }
  };

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">S-RABLE</h1>
          <p className="text-sm text-muted-foreground">Phase 1 · Step 1.5 — backend connection</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="inline-flex size-9 items-center justify-center rounded-md border bg-card hover:bg-muted"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </header>

      <section className="space-y-4 rounded-lg border bg-card p-5 text-card-foreground">
        <h2 className="text-sm font-semibold">Backend connection checks</h2>
        <Check
          label="GET /instruments (public)"
          expected="Expect 200"
          result={publicCheck}
          onRun={checkPublic}
        />
        <Check
          label="GET /users/me (no token)"
          expected="Expect 401"
          result={protectedCheck}
          onRun={checkProtected}
        />
      </section>
    </main>
  );
}

function Check(props: { label: string; expected: string; result: CheckResult; onRun: () => void }) {
  const { label, expected, result, onRun } = props;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onRun}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Run
      </button>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{expected}</p>
      </div>
      {result && (
        <p className={`text-sm font-medium ${result.ok ? 'text-success' : 'text-destructive'}`}>
          {result.ok ? 'PASS' : 'FAIL'} · {result.text}
        </p>
      )}
    </div>
  );
}
