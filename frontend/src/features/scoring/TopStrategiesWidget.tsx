import { Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useScores } from './queries';
import { scoreText } from './scoring-model';
import { CompatibilityText } from './ScoringViews';

/** Dashboard card: the user's three best-scored strategies (POST /scoring, default weights). */
export function TopStrategiesWidget() {
  const scores = useScores(null);
  const top = (scores.data?.rows ?? []).filter((r) => r.status === 'SCORED').slice(0, 3);
  return (
    <section aria-labelledby="top-strategies" className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Trophy aria-hidden className="size-4 text-muted-foreground" />
        <h2 id="top-strategies" className="text-sm font-medium">
          Top strategies by score
        </h2>
      </div>
      <div className="mt-3">
        {scores.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : scores.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              Could not load the scores: {(scores.error as Error).message}
            </p>
            <Button size="sm" variant="outline" onClick={() => void scores.refetch()}>
              Retry
            </Button>
          </div>
        ) : top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scored strategies yet: backtest a strategy made from a core template.
          </p>
        ) : (
          <div className="space-y-2">
            <ol className="space-y-1.5 text-sm">
              {top.map((row) => (
                <li key={row.strategy_id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-5 font-semibold tabular-nums">{row.rank}.</span>
                  <span className="font-medium">{row.name}</span>
                  <span className="tabular-nums text-muted-foreground">{`Score ${scoreText(row.composite_score)}`}</span>
                  <CompatibilityText value={row.regime_compatibility} />
                </li>
              ))}
            </ol>
            <Link to="/app/scoring" className="text-sm font-medium text-primary hover:underline">
              Open scoring &rarr;
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
