import { Blocks, Code2, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { CoreStrategyCard } from './CoreStrategyCard';
import { MyStrategiesTable } from './MyStrategiesTable';
import { useRegistry } from './queries';
import { StrategyFormDialog } from './StrategyFormDialog';

function CoreLibrary() {
  const registry = useRegistry();

  if (registry.isPending) {
    return (
      <div role="status" aria-label="Loading core strategies" className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-72 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  if (registry.isError) {
    return <ErrorState error={registry.error} onRetry={() => void registry.refetch()} />;
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {registry.data.map((entry) => (
        <CoreStrategyCard key={entry.strategy_key} entry={entry} />
      ))}
    </div>
  );
}

/** /app/strategies - the built-in strategy library and the user's own strategies. */
export default function StrategiesPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Strategies</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The built-in strategies the backtest engine runs, and the strategies you have saved.
        </p>
      </div>

      <section aria-labelledby="my-strategies" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="my-strategies" className="text-lg font-semibold">
            My strategies
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/app/builder/new">
                <Blocks /> Build without code
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/builder/new?type=python">
                <Code2 /> Write Python
              </Link>
            </Button>
            <StrategyFormDialog
              target={{ kind: 'new' }}
              trigger={
                <Button>
                  <Plus /> New strategy
                </Button>
              }
            />
          </div>
        </div>
        <MyStrategiesTable />
      </section>

      <section aria-labelledby="core-library" className="space-y-3">
        <div>
          <h2 id="core-library" className="text-lg font-semibold">
            Core strategies
          </h2>
          <p className="text-sm text-muted-foreground">
            Read-only templates from the backend registry. Parameters and defaults are loaded from
            the server.
          </p>
        </div>
        <CoreLibrary />
      </section>
    </div>
  );
}
