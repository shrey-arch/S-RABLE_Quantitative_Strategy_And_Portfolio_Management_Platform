import { useSearchParams } from 'react-router';
import { DateRangeField } from '@/components/ui/date-range-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Section } from '@/features/results/parts';
import {
  isNoModel,
  useCurrentRegime,
  useRegimeHistory,
  useRegimeModel,
  useRegimeModels,
} from './queries';
import {
  isRegimeTab,
  REGIME_TAB_LABELS,
  REGIME_TABS,
  type ModelCard,
  type RegimeModelDetail,
} from './regime-model';
import { ClassificationLabel, CurrentRegimeCard, HistoryView, ModelCardView } from './RegimeViews';
import { StrategyFit } from '@/features/scoring/StrategyFit';
import { TrainPanel } from './TrainPanel';

function NoModel() {
  return (
    <EmptyState
      title="No regime model yet"
      description="Train one on the Training tab. Until then no regime is shown anywhere."
    />
  );
}

function Overview() {
  const [params, setParams] = useSearchParams();
  const range = { start: params.get('from') ?? '', end: params.get('to') ?? '' };
  const current = useCurrentRegime();
  const history = useRegimeHistory({
    start: range.start || undefined,
    end: range.end || undefined,
  });
  const badRange = Boolean(range.start && range.end && range.end < range.start);

  if (current.isError && isNoModel(current.error)) return <NoModel />;
  return (
    <div className="space-y-6">
      {current.isError ? (
        <ErrorState error={current.error} onRetry={() => void current.refetch()} />
      ) : current.data ? (
        <CurrentRegimeCard current={current.data} />
      ) : (
        <LoadingState rows={4} />
      )}

      <Section
        id="history"
        title="Regime history"
        description="Each day's regime as classified by the model, on the reference instrument's closes. A supervised model's day is its classification of the next days, made with what was known that day."
      >
        <DateRangeField
          value={range}
          onChange={(v) =>
            setParams(
              (prev) => {
                const p = new URLSearchParams(prev);
                for (const [key, value] of [
                  ['from', v.start],
                  ['to', v.end],
                ] as const) {
                  if (value) p.set(key, value);
                  else p.delete(key);
                }
                return p;
              },
              { replace: true },
            )
          }
        />
        {badRange ? null : history.isError ? (
          isNoModel(history.error) ? null : (
            <ErrorState error={history.error} onRetry={() => void history.refetch()} />
          )
        ) : history.data ? (
          <HistoryView history={history.data} />
        ) : (
          <LoadingState rows={6} />
        )}
      </Section>

      <StrategyFit />
    </div>
  );
}

function ModelTab() {
  const [params] = useSearchParams();
  const models = useRegimeModels();
  const active = (models.data ?? []).find((m) => m.is_active);
  const id = params.get('model') ?? active?.id;
  const model = useRegimeModel(id);
  if (models.isError)
    return <ErrorState error={models.error} onRetry={() => void models.refetch()} />;
  if (models.isSuccess && !id) return <NoModel />;
  if (model.isError) return <ErrorState error={model.error} onRetry={() => void model.refetch()} />;
  if (!model.data) return <LoadingState rows={6} />;
  if (!model.data.card)
    return (
      <EmptyState
        title="This model has no card"
        description={
          model.data.status === 'FAILED'
            ? `Training failed: ${model.data.error_message ?? 'unknown error.'}`
            : 'It is still training.'
        }
      />
    );
  return <ModelCardView model={model.data as RegimeModelDetail & { card: ModelCard }} />;
}

function TrainingTab() {
  const models = useRegimeModels();
  if (models.isError)
    return <ErrorState error={models.error} onRetry={() => void models.refetch()} />;
  if (!models.data) return <LoadingState rows={6} />;
  const active = models.data.find((m) => m.is_active);
  return (
    <TrainPanel
      key={active?.id ?? 'none'}
      models={models.data}
      defaultInstrumentId={active?.instrument.id ?? ''}
    />
  );
}

/** /app/regime - the regime model's classification of the market, and the model itself. */
export default function RegimePage() {
  const [params, setParams] = useSearchParams();
  const current = useCurrentRegime();
  const value = params.get('tab');
  const tab = isRegimeTab(value) ? value : 'overview';
  const setTab = (next: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === 'overview') p.delete('tab');
        else p.set('tab', next);
        if (next !== 'model') p.delete('model');
        return p;
      },
      { replace: true },
    );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Market Regime</h1>
          <ClassificationLabel horizon={current.data?.horizon_days} />
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          A machine-learning model classifies the market from the reference index&apos;s stored
          daily data: a supervised model (Random Forest or XGBoost) classifies the volatility, trend
          and risk sentiment of the next days, with its out-of-sample accuracy on the model card; a
          Gaussian mixture groups recent behaviour into clusters. It is not advice.
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Market regime sections">
          {REGIME_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {REGIME_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="model">
          <ModelTab />
        </TabsContent>
        <TabsContent value="training">
          <TrainingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
