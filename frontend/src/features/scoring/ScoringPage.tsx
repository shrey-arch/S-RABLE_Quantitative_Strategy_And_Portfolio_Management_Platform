import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Section } from '@/features/results/parts';
import { useScores, useScoringDefinitions } from './queries';
import {
  buildWeights,
  compareIds,
  draftFromWeights,
  isScoringTab,
  SCORING_TAB_LABELS,
  SCORING_TABS,
  type Weights,
  type WeightsDraft,
} from './scoring-model';
import {
  Breakdown,
  CompareView,
  DefinitionsView,
  RankingTable,
  RegimeBanner,
  UnscoredList,
  WeightsPanel,
} from './ScoringViews';

/** /app/scoring - why the user's strategies rank as they do, and a comparison. */
export default function ScoringPage() {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = isScoringTab(value) ? value : 'ranking';
  const ids = compareIds(params.get('compare'));
  // Weights sent with the scoring request (null = the defaults). Not saved.
  const [weights, setWeights] = useState<Weights | null>(null);
  const [draft, setDraft] = useState<WeightsDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const definitions = useScoringDefinitions();
  const scores = useScores(weights);

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [key, v] of Object.entries(patch)) {
          if (v) p.set(key, v);
          else p.delete(key);
        }
        return p;
      },
      { replace: true },
    );
  const toggle = (id: string) => {
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    update({ compare: next.join(',') || null });
  };

  const defaults = definitions.data
    ? Object.fromEntries(
        definitions.data.strategies.map((s) => [s.strategy_key, s.default_weights]),
      )
    : null;
  const shownDraft = draft ?? (defaults ? draftFromWeights(weights ?? defaults) : {});

  const failed = [definitions, scores].find((q) => q.isError);
  const result = scores.data;
  const scored = result?.rows.filter((r) => r.status === 'SCORED') ?? [];
  const unscored = result?.rows.filter((r) => r.status !== 'SCORED') ?? [];
  const openId = params.get('strategy') ?? scored[0]?.strategy_id ?? null;
  const open = scored.find((r) => r.strategy_id === openId) ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <h1 className="page-title text-3xl">Scoring</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each of your strategies is scored on the instruments of its latest completed backtest:
          factors from stored daily closes, normalised and weighted into a composite score from 0 to
          1. Every number comes from the backend; the formulas are heuristics, not advice.
        </p>
      </div>
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : !result || !definitions.data ? (
        <LoadingState rows={6} />
      ) : (
        <>
          <RegimeBanner regime={result.regime} />
          <Tabs value={tab} onValueChange={(t) => update({ tab: t === 'ranking' ? null : t })}>
            <TabsList aria-label="Scoring sections">
              {SCORING_TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {SCORING_TAB_LABELS[t]}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="ranking" className="space-y-6">
              <Section
                id="ranking"
                title="Ranking"
                description={
                  result.custom_weights
                    ? 'By composite score, with your custom weights (not saved).'
                    : 'By composite score, with the default weights.'
                }
              >
                <RankingTable
                  rows={scored}
                  selected={ids}
                  onToggle={toggle}
                  open={open?.strategy_id ?? null}
                  onOpen={(id) => update({ strategy: id })}
                />
              </Section>
              {open && <Breakdown row={open} />}
              <UnscoredList rows={unscored} />
            </TabsContent>
            <TabsContent value="compare">
              <CompareView rows={result.rows} ids={ids} onToggle={toggle} />
            </TabsContent>
            <TabsContent value="weights" className="space-y-6">
              <WeightsPanel
                definitions={definitions.data}
                draft={shownDraft}
                onChange={setDraft}
                errors={errors}
                custom={result.custom_weights}
                pending={scores.isFetching}
                onApply={() => {
                  const built = buildWeights(shownDraft, defaults!);
                  if (!built.ok) {
                    setErrors(built.errors);
                    return;
                  }
                  setErrors({});
                  setWeights(built.weights);
                }}
                onReset={() => {
                  setErrors({});
                  setDraft(null);
                  setWeights(null);
                }}
              />
              <DefinitionsView definitions={definitions.data} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
