import { useQuery } from '@tanstack/react-query';
import { Moon, RefreshCw, Sun } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { getTheme, setTheme, type Theme } from '@/lib/theme';

/** Temporary Step 1.6 check page: the same backend calls, now through TanStack Query. */
export default function App() {
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  // Public route â€” loads automatically, cached under queryKeys.instruments.list()
  const instruments = useQuery({
    queryKey: queryKeys.instruments.list(),
    queryFn: () => unwrap(api.GET('/instruments')),
  });

  // Protected route without a token â€” 401 must NOT be retried
  const me = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => unwrap(api.GET('/users/me')),
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="page-title text-3xl">S-RABLE</h1>
          <p className="text-sm text-muted-foreground">Phase 1 Â· Step 1.6 â€” TanStack Query</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          className="inline-flex size-9 items-center justify-center rounded-md border bg-card shadow-card hover:bg-muted"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </header>

      <section className="space-y-4 rounded-lg border bg-card shadow-card p-5 text-card-foreground">
        <h2 className="text-sm font-semibold">Query states</h2>

        <Row label="GET /instruments" expected="Expect: success">
          {instruments.isPending
            ? 'Loadingâ€¦'
            : instruments.isError
              ? `Error ${(instruments.error as ApiError).status} â€” ${instruments.error.message}`
              : `Success â€” ${instruments.data.length} instrument(s)`}
        </Row>

        <Row label="GET /users/me (no token)" expected="Expect: error 401, no retries">
          {me.isPending
            ? 'Loadingâ€¦'
            : me.isError
              ? `Error ${(me.error as ApiError).status} â€” ${me.error.message} Â· attempts: ${me.failureCount}`
              : 'Unexpected success'}
        </Row>

        <button
          type="button"
          onClick={() => void instruments.refetch()}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className={`size-4 ${instruments.isFetching ? 'animate-spin' : ''}`} />
          Refetch instruments
        </button>
      </section>
    </main>
  );
}

function Row(props: { label: string; expected: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p className="font-mono text-sm">{props.label}</p>
        <p className="text-xs text-muted-foreground">{props.expected}</p>
      </div>
      <p className="text-sm font-medium">{props.children}</p>
    </div>
  );
}
