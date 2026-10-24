import { Compass } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { istDate } from '@/features/instruments/market-data';
import { formatDate, formatPercent } from '@/lib/format';
import { isNoModel, useCurrentRegime } from './queries';
import { RegimeChip } from './RegimeChart';
import { classificationText } from './regime-model';

/** Dashboard card: the active model's current regime (GET /regime/current). */
export function RegimeWidget() {
  const current = useCurrentRegime();
  return (
    <section aria-labelledby="regime-widget" className="rounded-xl border bg-card shadow-card p-5">
      <div className="flex items-center gap-2">
        <Compass aria-hidden className="size-4 text-muted-foreground" />
        <h2 id="regime-widget" className="text-sm font-medium">
          Market regime
        </h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {classificationText(current.data?.horizon_days)}
        </span>
      </div>
      <div className="mt-3">
        {current.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : current.isError ? (
          isNoModel(current.error) ? (
            <p className="text-sm text-muted-foreground">
              No regime model yet.{' '}
              <Link
                to="/app/regime?tab=training"
                className="font-medium text-primary hover:underline"
              >
                Train one
              </Link>
            </p>
          ) : (
            <div className="space-y-2">
              <p role="alert" className="text-sm text-destructive">
                Could not load the regime: {(current.error as Error).message}
              </p>
              <Button size="sm" variant="outline" onClick={() => void current.refetch()}>
                Retry
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <RegimeChip code={current.data.regime.code} />
              <span className="font-semibold">{current.data.regime.name}</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {`${current.data.dimensions ? 'Combined probability' : 'Confidence'} ${formatPercent(current.data.confidence)} \u00b7 ${current.data.instrument.symbol ?? 'Deleted instrument'} \u00b7 as of ${formatDate(istDate(current.data.as_of))}`}
            </p>
            <Link to="/app/regime" className="text-sm font-medium text-primary hover:underline">
              Open market regime &rarr;
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
