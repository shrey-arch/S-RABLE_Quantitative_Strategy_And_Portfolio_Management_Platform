import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { RegistryEntry } from '@/features/strategies/core-strategies';
import { formatNumber } from '@/lib/format';
import { RegimeModelPicker } from './RegimeModelPicker';
import {
  gridCombinations,
  parseGridValues,
  windowCount,
  type RegimeSource,
  type ValidationDraft,
} from './validation-model';

/**
 * The validation settings of the launcher (walk-forward, regime stress, Monte
 * Carlo), below the backtest settings it shares with a backtest.
 */
export function ValidationSettingsFields(props: {
  draft: ValidationDraft;
  onChange: (change: Partial<ValidationDraft>) => void;
  errors: Record<string, string>;
  entry: RegistryEntry;
  rules: boolean;
  /** Daily bars in the chosen range, once the data check has answered. */
  bars: number | null;
  /** The backtest's dates (for the regime model's in-sample warning). */
  range: { start: string; end: string };
}) {
  const { draft, errors, entry } = props;
  const number = (raw: string) => (/^\d+$/.test(raw.trim()) ? Number(raw) : null);
  const sizes = {
    train: number(draft.trainBars),
    validation: number(draft.validationBars),
    test: number(draft.testBars),
    step: draft.stepBars.trim() ? number(draft.stepBars) : number(draft.testBars),
  };
  const windows =
    props.bars !== null && Object.values(sizes).every((v) => v !== null)
      ? windowCount(props.bars, sizes as Record<keyof typeof sizes, number>)
      : null;

  const parsedGrid: Record<string, number[]> = {};
  for (const param of entry.parameters) {
    const parsed = parseGridValues(draft.grid[param.name] ?? '', param.type === 'int');
    if (Array.isArray(parsed) && parsed.length) parsedGrid[param.name] = parsed;
  }
  const combinations = gridCombinations(parsedGrid);
  const searched = Object.keys(parsedGrid).length > 0;

  const field = (
    key: keyof ValidationDraft & string,
    label: string,
    hint: string,
    inputMode: 'numeric' = 'numeric',
  ) => (
    <FormField label={label} error={errors[`v.${key}`]} hint={hint}>
      {(f) => (
        <Input
          {...f}
          inputMode={inputMode}
          value={draft[key] as string}
          onChange={(e) => props.onChange({ [key]: e.target.value })}
        />
      )}
    </FormField>
  );

  return (
    <>
      <FormSection
        title="Walk-forward"
        description="Rolling windows over the range. In each window the train span is warm-up only (nothing is traded on it), parameters are chosen on the validation span (in-sample), and then tested unchanged on the next test span (out-of-sample)."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {field('trainBars', 'Train span (bars)', 'Warm-up before each validation span.')}
          {field(
            'validationBars',
            'Validation span (bars)',
            'In-sample: parameters are chosen here.',
          )}
          {field(
            'testBars',
            'Test span (bars)',
            'Out-of-sample: the chosen parameters are tested here.',
          )}
          {field(
            'stepBars',
            'Step (bars)',
            'Bars between window starts. Empty: the test span, so test spans do not overlap.',
          )}
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {windows === null
            ? 'The number of windows is shown once the dates have stored data and the spans are whole numbers.'
            : `With ${formatNumber(props.bars, 0)} daily bars in the range: ${windows} ${windows === 1 ? 'window' : 'windows'}. The backend says if that is not enough.`}
        </p>

        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-medium">Parameter search (optional)</h3>
          {props.rules ? (
            <p className="text-sm text-muted-foreground">
              A no-code strategy is validated with its saved rules; there are no parameters to
              search.
            </p>
          ) : entry.parameters.length === 0 ? (
            <p className="text-sm text-muted-foreground">This strategy has no parameters.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {entry.parameters.map((param) => (
                  <FormField
                    key={param.name}
                    label={`${param.name} candidates`}
                    error={errors[`v.grid.${param.name}`]}
                    hint="Values separated by commas, e.g. 10, 20, 30. Empty: the value above on every window."
                  >
                    {(f) => (
                      <Input
                        {...f}
                        className="font-mono"
                        value={draft.grid[param.name] ?? ''}
                        onChange={(e) =>
                          props.onChange({ grid: { ...draft.grid, [param.name]: e.target.value } })
                        }
                      />
                    )}
                  </FormField>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {searched
                  ? `${combinations} ${combinations === 1 ? 'combination is' : 'combinations are'} tried on each validation span; the one with the highest return is tested. The backend allows up to 25.`
                  : 'No search: the strategy is tested with the parameters above on every window.'}
              </p>
            </>
          )}
        </div>
      </FormSection>

      <FormSection
        title="Regime stress"
        description={
          draft.regimeSource === 'model'
            ? "The backtest's daily returns are split by the regime the market regime model classified on each day (a supervised model also by each dimension). A regime with fewer than 20 days is not judged."
            : "The backtest's daily returns are split by market regime: bull or bear (close against its trend average) and low or high volatility (against the median over the range)."
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Regime source" hint="Where each day's regime comes from.">
            {(f) => (
              <NativeSelect
                {...f}
                value={draft.regimeSource}
                onChange={(e) => props.onChange({ regimeSource: e.target.value as RegimeSource })}
              >
                <NativeSelectOption value="rule_based">
                  Rule-based (trend and volatility of prices)
                </NativeSelectOption>
                <NativeSelectOption value="model">Market regime model</NativeSelectOption>
              </NativeSelect>
            )}
          </FormField>
          {draft.regimeSource === 'model' ? (
            <RegimeModelPicker
              draft={draft}
              onChange={props.onChange}
              range={props.range}
              error={errors['v.regimeModelId']}
            />
          ) : (
            <>
              <div aria-hidden className="hidden sm:block" />
              {field(
                'trendWindow',
                'Trend average (days)',
                'Bull when the close is at or above it.',
              )}
              {field(
                'volatilityWindow',
                'Volatility window (days)',
                'Days of returns in each volatility estimate.',
              )}
            </>
          )}
        </div>
      </FormSection>

      <FormSection
        title="Monte Carlo"
        description="Resamples the backtest's daily returns to show the range of outcomes, and tests whether the mean daily return beats chance. The same seed and data give the same results."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {field('simulations', 'Simulations', 'Resampled paths, and permutations of the test.')}
          {field('seed', 'Seed', 'Any whole number; keep it to reproduce a run.')}
        </div>
      </FormSection>
    </>
  );
}
