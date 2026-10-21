import { AlertTriangle, Blocks, Code2 } from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '@/api/errors';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useIndicators } from '@/features/indicators/queries';
import { useStrategy } from '@/features/strategies/queries';
import { strategyKind } from '@/features/strategies/strategy-kind';
import { cn } from '@/lib/utils';
import { emptyDraft, fromStrategy } from './builder-model';
import { NoCodeBuilder } from './NoCodeBuilder';
import { PYTHON_TEMPLATE } from './python/python-template';

function Page(props: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <Link to="/app/strategies" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Strategies
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
        {props.intro && <p className="mt-1 text-sm text-muted-foreground">{props.intro}</p>}
      </div>
      {props.children}
    </div>
  );
}

// The code editor (CodeMirror) is large; it is downloaded only when a Python strategy opens.
const PythonEditor = lazy(() =>
  import('./python/PythonEditor').then((m) => ({ default: m.PythonEditor })),
);

const INTRO = {
  'no-code':
    'Build a strategy from indicators and conditions, without code. It is saved as a StrategyConfig through the Strategy API.',
  python:
    'Write a strategy in Python. The code is saved and versioned through the Strategy API; it is not run.',
};

/** New strategies only: choose how to build it (kept in the address as ?type=python). */
function KindSwitch({ kind }: { kind: 'no-code' | 'python' }) {
  const item = (value: 'no-code' | 'python', label: string, Icon: typeof Blocks) => (
    <Link
      to={value === 'python' ? '/app/builder/new?type=python' : '/app/builder/new'}
      aria-current={kind === value ? 'page' : undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
        kind === value
          ? 'bg-primary font-medium text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <Icon aria-hidden className="size-4" /> {label}
    </Link>
  );
  return (
    <nav aria-label="Kind of strategy" className="inline-flex gap-1 rounded-lg border p-1">
      {item('no-code', 'No code', Blocks)}
      {item('python', 'Python', Code2)}
    </nav>
  );
}

/** 404 = missing or not this user's; 422 = not a valid id. The page does not say which. */
const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** /app/builder/new and /app/builder/:id - the no-code strategy builder. */
export default function BuilderPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const catalogue = useIndicators();
  const strategy = useStrategy(id ?? '', Boolean(id));
  const title = id ? 'Edit strategy' : 'Strategy Builder';

  const loaded = useMemo(
    () => (strategy.data ? fromStrategy(strategy.data) : null),
    [strategy.data],
  );

  if (id && strategy.isError && isNotAvailable(strategy.error)) {
    return (
      <Page title={title}>
        <p className="text-sm text-muted-foreground">
          This strategy does not exist, or it belongs to another account.
        </p>
        <Button asChild>
          <Link to="/app/strategies">Back to strategies</Link>
        </Button>
      </Page>
    );
  }

  const failed = (query: typeof catalogue | typeof strategy) => (
    <Page title={title}>
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    </Page>
  );
  const loading = (
    <Page title={title}>
      <LoadingState rows={6} />
    </Page>
  );

  if (id && strategy.isError) return failed(strategy);
  if (id && !strategy.isSuccess) return loading;

  const kind = strategy.data
    ? strategyKind(strategy.data)
    : search.get('type') === 'python'
      ? 'python'
      : 'no-code';

  if (id && strategy.data && kind === 'template') {
    return (
      <Page title={title}>
        <p className="text-sm">
          <span className="font-medium">{strategy.data.name}</span> was not made in the no-code
          builder or the Python editor, so it is edited on its strategy page.
        </p>
        <Button asChild>
          <Link to={`/app/strategies/${strategy.data.id}`}>Open the strategy</Link>
        </Button>
      </Page>
    );
  }

  if (kind === 'python') {
    return (
      <Page title={title} intro={INTRO.python}>
        {!id && <KindSwitch kind="python" />}
        {id && strategy.data && (
          <p className="text-sm text-muted-foreground">
            Editing <span className="font-medium text-foreground">{strategy.data.name}</span>{' '}
            (version {strategy.data.version}).
          </p>
        )}
        <Suspense fallback={<LoadingState rows={6} />}>
          <PythonEditor
            key={strategy.data?.id ?? 'new'}
            initial={
              strategy.data
                ? {
                    name: strategy.data.name,
                    description: strategy.data.description ?? '',
                    code: strategy.data.python_code ?? '',
                  }
                : { name: '', description: '', code: PYTHON_TEMPLATE }
            }
            strategyId={id ? strategy.data?.id : undefined}
            version={strategy.data?.version}
          />
        </Suspense>
      </Page>
    );
  }

  // Only the no-code builder needs the indicator catalogue.
  if (catalogue.isError) return failed(catalogue);
  if (!catalogue.isSuccess) return loading;

  return (
    <Page title={title} intro={INTRO['no-code']}>
      {!id && <KindSwitch kind="no-code" />}
      {id && strategy.data && (
        <p className="text-sm text-muted-foreground">
          Editing <span className="font-medium text-foreground">{strategy.data.name}</span> (version{' '}
          {strategy.data.version}). Changing indicators or conditions saves a new version.
        </p>
      )}
      {loaded?.lossy && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
          Part of the saved configuration could not be read by the builder and is not shown. Saving
          here will remove that part.
        </p>
      )}
      <NoCodeBuilder
        key={strategy.data?.id ?? 'new'}
        initial={loaded?.draft ?? emptyDraft()}
        strategyId={id ? strategy.data?.id : undefined}
        catalogue={catalogue.data}
      />
    </Page>
  );
}
