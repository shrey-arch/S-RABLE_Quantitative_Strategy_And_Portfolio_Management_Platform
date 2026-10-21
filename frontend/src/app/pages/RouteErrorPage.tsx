import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

/**
 * Error boundary for a single route. Shown when a page crashes or fails to load.
 * Never shows stack traces to the user; logs the error to the console for developers.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  console.error(error);

  const message = error instanceof Error ? error.message : '';
  // After a new deployment, old page files may no longer exist on the server.
  const isStaleBuild = /dynamically imported module|Importing a module script failed/i.test(
    message,
  );
  const title = isRouteErrorResponse(error)
    ? `${error.status} — ${error.statusText}`
    : isStaleBuild
      ? 'A new version is available'
      : 'This page failed to load';

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8" role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">
        {isStaleBuild
          ? 'Reload to get the latest version.'
          : 'Something went wrong on this page. The rest of the app still works.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Reload
        </button>
        <Link to="/" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
          Home
        </Link>
      </div>
    </main>
  );
}
