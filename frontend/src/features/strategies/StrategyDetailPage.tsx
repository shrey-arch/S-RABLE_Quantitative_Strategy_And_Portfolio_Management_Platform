import { CircleSlash, Copy, Pencil, Play, ShieldCheck, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { ValidationSummary } from '@/features/validation/ValidationBadge';
import { formatDateTime, humanize } from '@/lib/format';
import { useDeleteStrategy, useStrategy } from './queries';
import { StrategyConfigView } from './StrategyConfigView';
import { StrategyFormDialog } from './StrategyFormDialog';
import { BACKTEST_BLOCKED, PYTHON_NOT_DEPLOYABLE, strategyKind } from './strategy-kind';

function BackLink() {
  return (
    <Link to="/app/strategies" className="text-sm text-muted-foreground hover:text-foreground">
      &larr; Strategies
    </Link>
  );
}

/**
 * 404 = not found or not this user's (the backend does not say which, and neither do we).
 * 422 = the id in the address is not a valid id.
 */
const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

function NotAvailable() {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <CircleSlash className="size-6" />
      </span>
      <h1 className="mt-4 page-title text-3xl">Strategy not available</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This strategy does not exist, or it belongs to another account.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/strategies">Back to strategies</Link>
      </Button>
    </div>
  );
}

/** /app/strategies/:id - one of the user's strategies, read-only, with its actions. */
export default function StrategyDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useStrategy(id);
  const remove = useDeleteStrategy();

  if (query.isError && isNotAvailable(query.error)) {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <BackLink />
        <NotAvailable />
      </div>
    );
  }

  if (!query.isSuccess) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
        <BackLink />
        <h1 className="page-title text-3xl">Strategy</h1>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingState rows={6} />
        )}
      </div>
    );
  }

  const strategy = query.data;
  const kind = strategyKind(strategy);
  const backtestBlocked = BACKTEST_BLOCKED[kind];

  const onDelete = async () => {
    try {
      await remove.mutateAsync(strategy);
    } catch (error) {
      if (!isNotAvailable(error)) {
        toast.error(`Could not delete: ${(error as Error).message}`);
        return;
      }
      // Already gone (deleted in another tab): treat as deleted.
    }
    navigate('/app/strategies', { replace: true });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <h1 className="page-title text-3xl break-words">{strategy.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge kind="active" value={strategy.is_active} />
            <span>{humanize(strategy.strategy_type)}</span>
            <span aria-hidden>&middot;</span>
            <span>Version {strategy.version}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {backtestBlocked ? (
            <Button disabled aria-describedby="backtest-blocked">
              <Play /> Backtest
            </Button>
          ) : (
            <Button asChild>
              <Link to={`/app/backtests/new?strategy=${encodeURIComponent(strategy.id)}`}>
                <Play /> Backtest
              </Link>
            </Button>
          )}
          {kind === 'template' ? (
            <StrategyFormDialog
              target={{ kind: 'edit', strategy }}
              trigger={
                <Button variant="outline">
                  <Pencil /> Edit
                </Button>
              }
            />
          ) : (
            <Button asChild variant="outline">
              <Link to={`/app/builder/${encodeURIComponent(strategy.id)}`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )}
          <StrategyFormDialog
            target={{ kind: 'duplicate', source: strategy }}
            trigger={
              <Button variant="outline">
                <Copy /> Duplicate
              </Button>
            }
          />
          <ConfirmDialog
            trigger={
              <Button variant="outline">
                <Trash2 /> Delete
              </Button>
            }
            title={`Delete ${strategy.name}?`}
            description="The strategy and its configuration are removed permanently. This cannot be undone."
            confirmLabel="Delete strategy"
            onConfirm={onDelete}
          />
          {backtestBlocked ? (
            <Button variant="outline" disabled aria-describedby="backtest-blocked">
              <ShieldCheck /> Validate
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to={`/app/validation/new?strategy=${encodeURIComponent(strategy.id)}`}>
                <ShieldCheck /> Validate
              </Link>
            </Button>
          )}
        </div>
      </div>

      {backtestBlocked && (
        <p
          id="backtest-blocked"
          className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground"
        >
          {backtestBlocked}
        </p>
      )}

      <dl className="grid gap-4 rounded-xl border bg-card shadow-card p-4 text-sm sm:grid-cols-3">
        {strategy.validation && (
          <div className="sm:col-span-3">
            <dt className="text-xs text-muted-foreground">Validation</dt>
            <dd className="mt-1" aria-label="Validation status">
              <ValidationSummary
                validation={strategy.validation}
                strategyId={strategy.id}
                canValidate={!backtestBlocked}
              />
            </dd>
          </div>
        )}
        <div className="sm:col-span-3">
          <dt className="text-xs text-muted-foreground">Description</dt>
          <dd className="mt-1 whitespace-pre-wrap">
            {strategy.description || <span className="text-muted-foreground">No description.</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Created</dt>
          <dd className="mt-1 tabular-nums">{formatDateTime(strategy.created_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last updated</dt>
          <dd className="mt-1 tabular-nums">{formatDateTime(strategy.updated_at)}</dd>
        </div>
      </dl>

      {kind === 'python' ? (
        <section aria-labelledby="code-heading" className="space-y-3">
          <h2 id="code-heading" className="text-lg font-semibold">
            Python code
          </h2>
          <p className="text-sm text-muted-foreground">
            Saved and versioned. It runs only inside the backend&apos;s isolated sandbox: test-run
            it in the editor, or backtest and validate it like any other strategy.
          </p>
          <p className="text-sm text-muted-foreground">{PYTHON_NOT_DEPLOYABLE}</p>
          <pre
            aria-label="Saved Python code"
            className="max-h-[32rem] overflow-auto rounded-xl border bg-muted p-4 font-mono text-xs"
          >
            {strategy.python_code}
          </pre>
        </section>
      ) : (
        <section aria-labelledby="config-heading" className="space-y-3">
          <h2 id="config-heading" className="text-lg font-semibold">
            Configuration
          </h2>
          <StrategyConfigView config={strategy.strategy_config} />
        </section>
      )}
    </div>
  );
}
