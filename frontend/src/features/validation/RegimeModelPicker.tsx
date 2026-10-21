import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { FormField } from '@/components/ui/form-field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { istDate } from '@/features/instruments/market-data';
import { useRegimeModel, useRegimeModels } from '@/features/regime/queries';
import { KIND_SHORT, modelName } from '@/features/regime/regime-model';
import { formatDate } from '@/lib/format';
import { inSampleEnd, trainingOverlap, type ValidationDraft } from './validation-model';

const day = (t: string) => formatDate(istDate(t));

/**
 * What the chosen model was trained on, and whether the run's dates overlap it
 * (those days are classified in-sample; the report counts them).
 */
export function ModelOverlapNote(props: { modelId: string; start: string; end: string }) {
  const model = useRegimeModel(props.modelId || undefined);
  const card = model.data?.card;
  if (!card) return null;
  const last = inSampleEnd(card);
  const overlap = trainingOverlap(
    { start: props.start, end: props.end },
    { start: card.training_start, end: last },
  );
  const trained = `${modelName(model.data!)} (${KIND_SHORT[model.data!.model_kind]}) was trained on ${model.data!.instrument.symbol ?? 'a deleted instrument'} from ${day(card.training_start)} to ${day(last)}.`;
  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted-foreground">{trained}</p>
      {overlap === 'overlap' && (
        <p role="note" className="flex items-start gap-1.5 font-medium text-warning">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          The dates overlap its training period: those days are classified in-sample (the model has
          seen them). The report counts them.
        </p>
      )}
      {overlap === 'unknown' && (
        <p className="text-muted-foreground">
          Choose dates to see whether they overlap its training period.
        </p>
      )}
    </div>
  );
}

/** Regime source "Market regime model": pick a ready model (the active one first). */
export function RegimeModelPicker(props: {
  draft: ValidationDraft;
  onChange: (change: Partial<ValidationDraft>) => void;
  range: { start: string; end: string };
  error?: string;
}) {
  const models = useRegimeModels();
  const ready = (models.data ?? []).filter((m) => m.status === 'READY');
  const active = ready.find((m) => m.is_active);
  const { regimeModelId } = props.draft;
  const { onChange } = props;
  useEffect(() => {
    // The active model is preselected.
    if (!regimeModelId && active) onChange({ regimeModelId: active.id });
  }, [regimeModelId, active, onChange]);

  if (models.isSuccess && ready.length === 0)
    return (
      <p role="alert" className="text-sm text-warning sm:col-span-2">
        No regime model has been trained yet.{' '}
        <Link
          to="/app/regime?tab=training"
          className="font-medium underline-offset-4 hover:underline"
        >
          Train one on the Market Regime page
        </Link>
        , or use the rule-based regimes.
      </p>
    );
  return (
    <>
      <FormField
        label="Regime model"
        error={props.error}
        hint="Each day takes the regime this model classified on that day, from data up to that day."
      >
        {(f) => (
          <NativeSelect
            {...f}
            value={regimeModelId}
            disabled={!models.isSuccess}
            onChange={(e) => onChange({ regimeModelId: e.target.value })}
          >
            {ready.map((m) => (
              <NativeSelectOption key={m.id} value={m.id}>
                {`${modelName(m)} \u00b7 ${KIND_SHORT[m.model_kind]} \u00b7 ${m.instrument.symbol ?? 'deleted instrument'}${m.is_active ? ' (active)' : ''}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <div className="sm:col-span-2">
        {regimeModelId && (
          <ModelOverlapNote
            modelId={regimeModelId}
            start={props.range.start}
            end={props.range.end}
          />
        )}
      </div>
    </>
  );
}
