import { Link } from 'react-router';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Section } from '@/features/results/parts';
import { coreInfo } from '@/features/strategies/core-strategies';
import { useRegimeFit } from './queries';
import { CompatibilityText } from './ScoringViews';

/**
 * Market Regime page: each core strategy's compatibility with the current regime,
 * by the backend's rule table (GET /scoring/regime-fit).
 */
export function StrategyFit() {
  const fit = useRegimeFit();
  return (
    <Section
      id="strategy-fit"
      title="Strategy fit"
      description="Which core strategies suit the current regime, by a documented rule from how each one trades. It is not a forecast and does not change any score."
      actions={
        <Link to="/app/scoring" className="text-sm font-medium text-primary hover:underline">
          Scores of your strategies &rarr;
        </Link>
      }
    >
      {fit.isError ? (
        <ErrorState error={fit.error} onRetry={() => void fit.refetch()} />
      ) : !fit.data ? (
        <LoadingState rows={3} />
      ) : (
        <ul className="divide-y text-sm" aria-label="Strategy fit">
          {fit.data.strategies.map((s) => (
            <li key={s.strategy_key} className="grid gap-1 py-2 sm:grid-cols-[14rem_8rem_1fr]">
              <span className="font-medium">{coreInfo(s.strategy_key).name}</span>
              <CompatibilityText value={s.compatibility} />
              <span className="text-muted-foreground">{s.rule.rule}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
