import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { istDate } from '@/features/instruments/market-data';
import { Section } from '@/features/results/parts';
import { isNoModel, useCurrentRegime } from '@/features/regime/queries';
import { useScores } from '@/features/scoring/queries';
import { coreInfo } from '@/features/strategies/core-strategies';
import { Switch } from '@/components/ui/switch';
import { ValidationBadge, ValidationLinks } from '@/features/validation/ValidationBadge';
import { formatDate, formatINR } from '@/lib/format';
import {
  newRow,
  type AssetPrice,
  type HoldingRow,
  type LimitsDraft,
  type PlanDraft,
  type PortfolioAccount,
  type StateDraft,
} from './portfolio-model';

const fieldError = (errors: Record<string, string>, key: string) => errors[key];

/**
 * Candidate strategies (the user's, scored as on the Scoring page), an optional
 * regime of the active regime model (prefilled with the current one) and the
 * risk limits. Shared by the target and rebalance calculations.
 */
export function PlanSettings(props: {
  plan: PlanDraft;
  onChange: (plan: PlanDraft) => void;
  errors: Record<string, string>;
}) {
  const { plan, onChange, errors } = props;
  const scores = useScores(null);
  const current = useCurrentRegime();
  const setLimit = (key: keyof LimitsDraft, value: string) =>
    onChange({ ...plan, limits: { ...plan.limits, [key]: value } });
  const toggle = (id: string) =>
    onChange({
      ...plan,
      strategyIds: plan.strategyIds.includes(id)
        ? plan.strategyIds.filter((x) => x !== id)
        : [...plan.strategyIds, id],
    });
  const noModel = current.isError && isNoModel(current.error);

  return (
    <Section
      id="plan-settings"
      title="Strategies and risk limits"
      description="Capital is split by composite score among the chosen strategies, then limited. Used by the target and the rebalance plan."
    >
      <fieldset
        className="space-y-2"
        aria-describedby={errors.strategies ? 'strategies-error' : undefined}
      >
        <legend className="text-sm font-medium">Candidate strategies</legend>
        {scores.isError ? (
          <ErrorState error={scores.error} onRetry={() => void scores.refetch()} />
        ) : !scores.data ? (
          <LoadingState rows={3} />
        ) : scores.data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You have no saved strategies yet.{' '}
            <Link to="/app/strategies" className="text-primary hover:underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Candidate strategies">
            {scores.data.rows.map((row) => {
              const scored = row.status === 'SCORED';
              return (
                <li key={row.strategy_id} className="rounded-md border p-2 text-sm">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4"
                      checked={scored && plan.strategyIds.includes(row.strategy_id)}
                      disabled={!scored}
                      onChange={() => toggle(row.strategy_id)}
                    />
                    <span>
                      <span className="font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {scored
                          ? `${row.strategy_key ? coreInfo(row.strategy_key).name : ''} \u00b7 score ${row.composite_score?.toFixed(3)}`
                          : row.reason}
                      </span>
                    </span>
                  </label>
                  {row.validation && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                      <ValidationBadge validation={row.validation} />
                      <ValidationLinks validation={row.validation} strategyId={row.strategy_id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {errors.strategies && (
          <p id="strategies-error" role="alert" className="text-xs text-destructive">
            {errors.strategies}
          </p>
        )}
      </fieldset>

      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Switch
            id="include-unvalidated"
            checked={Boolean(plan.includeUnvalidated)}
            onCheckedChange={(on) => onChange({ ...plan, includeUnvalidated: on })}
          />
          <label htmlFor="include-unvalidated" className="text-sm font-medium">
            Include unvalidated strategies
          </label>
        </div>
        {plan.includeUnvalidated ? (
          <p role="note" className="flex items-start gap-1.5 text-sm font-medium text-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            For experiments only: strategies without a passing validation of their current version
            also get capital.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Off: only strategies whose current version passed validation get capital; the others are
            listed under Not allocated with the reason.
          </p>
        )}
      </div>

      <FormField
        label="Regime"
        hint={
          noModel
            ? 'No regime model has been trained, so no regime filter is available.'
            : 'Strategies not compatible with this regime (by the documented rule table) are left out.'
        }
      >
        {(field) => (
          <NativeSelect
            {...field}
            value={plan.regime}
            onChange={(e) => onChange({ ...plan, regime: e.target.value })}
          >
            <option value="">No regime filter</option>
            {current.data?.probabilities.map((p) => (
              <option key={p.code} value={p.code}>
                {`${p.code} ${p.name}${p.code === current.data!.regime.code ? ' (current)' : ''}`}
              </option>
            ))}
          </NativeSelect>
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Cash reserve (Rs)" error={fieldError(errors, 'cashReserve')}>
          {(field) => (
            <Input
              {...field}
              inputMode="decimal"
              value={plan.limits.cashReserve}
              onChange={(e) => setLimit('cashReserve', e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Max strategy weight (%)" error={fieldError(errors, 'maxStrategyPct')}>
          {(field) => (
            <Input
              {...field}
              inputMode="decimal"
              value={plan.limits.maxStrategyPct}
              onChange={(e) => setLimit('maxStrategyPct', e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Max asset weight (%)" error={fieldError(errors, 'maxAssetPct')}>
          {(field) => (
            <Input
              {...field}
              inputMode="decimal"
              value={plan.limits.maxAssetPct}
              onChange={(e) => setLimit('maxAssetPct', e.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Max invested capital (Rs)"
          error={fieldError(errors, 'maxInvested')}
          hint="Optional."
        >
          {(field) => (
            <Input
              {...field}
              inputMode="decimal"
              value={plan.limits.maxInvested}
              onChange={(e) => setLimit('maxInvested', e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Section>
  );
}

/**
 * The saved holdings with a price for each: prefilled with the latest stored
 * daily close (labelled with its date), or the saved valuation price when there
 * is none. Prices can be changed; quantities and cash are the saved ones.
 */
export function RebalanceInputs(props: {
  account: PortfolioAccount;
  prices: Record<string, string>;
  latest: AssetPrice[] | undefined;
  onPrice: (asset: string, value: string) => void;
  minimumTrade: string;
  onMinimumTrade: (value: string) => void;
  errors: Record<string, string>;
}) {
  const { account, errors } = props;
  const latest = new Map((props.latest ?? []).map((p) => [p.asset, p]));
  return (
    <Section
      id="rebalance-inputs"
      title="Current holdings and prices"
      description={`Saved cash ${formatINR(account.cash)}. Assets you do not hold yet are priced at their latest stored close; the plan lists every price used.`}
    >
      {account.holdings.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Prices for the rebalance</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Asset</th>
                <th className="py-2 pr-2 text-right font-medium">Quantity</th>
                <th className="py-2 pr-2 font-medium">Price (Rs)</th>
              </tr>
            </thead>
            <tbody>
              {account.holdings.map((h) => {
                const close = latest.get(h.asset);
                const error = errors[`price.${h.asset}`];
                return (
                  <tr key={h.asset} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-2 font-medium">{h.asset}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{h.quantity}</td>
                    <td className="py-2 pr-2">
                      <Input
                        aria-label={`Price of ${h.asset}`}
                        aria-invalid={error ? true : undefined}
                        inputMode="decimal"
                        className="w-36"
                        value={props.prices[h.asset] ?? ''}
                        onChange={(e) => props.onPrice(h.asset, e.target.value)}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {close?.price && close.as_of
                          ? `Latest stored close ${formatINR(close.price)} on ${formatDate(istDate(close.as_of))} (historical)`
                          : `Saved valuation price ${formatINR(h.price)}${close?.reason ? `; ${close.reason}` : ''}`}
                      </p>
                      {error && (
                        <p role="alert" className="text-xs text-destructive">
                          {error}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <FormField
        label="Minimum trade value (Rs)"
        error={errors.minimumTrade}
        hint="Smaller adjustments are skipped."
        className="max-w-xs"
      >
        {(field) => (
          <Input
            {...field}
            inputMode="decimal"
            value={props.minimumTrade}
            onChange={(e) => props.onMinimumTrade(e.target.value)}
          />
        )}
      </FormField>
    </Section>
  );
}

/** Cash and holdings to save. Nothing is saved until the user confirms. */
export function StateEditor(props: {
  draft: StateDraft;
  onChange: (draft: StateDraft) => void;
  errors: Record<string, string>;
}) {
  const { draft, onChange, errors } = props;
  const setRow = (key: string, patch: Partial<HoldingRow>) =>
    onChange({
      ...draft,
      rows: draft.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    });
  return (
    <div className="space-y-4">
      <FormField label="Cash (Rs)" error={errors.cash} className="max-w-xs">
        {(field) => (
          <Input
            {...field}
            inputMode="decimal"
            value={draft.cash}
            onChange={(e) => onChange({ ...draft, cash: e.target.value })}
          />
        )}
      </FormField>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">Holdings to save</caption>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Asset (trading symbol)</th>
              <th className="py-2 pr-2 font-medium">Quantity</th>
              <th className="py-2 pr-2 font-medium">Price (Rs)</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, i) => (
              <tr key={row.key} className="border-b last:border-0 align-top">
                {(['asset', 'quantity', 'price'] as const).map((field) => {
                  const error = errors[`${row.key}.${field}`];
                  return (
                    <td key={field} className="py-2 pr-2">
                      <Input
                        aria-label={`Holding ${i + 1} ${field}`}
                        aria-invalid={error ? true : undefined}
                        inputMode={field === 'asset' ? undefined : 'decimal'}
                        value={row[field]}
                        onChange={(e) => setRow(row.key, { [field]: e.target.value })}
                      />
                      {error && (
                        <p role="alert" className="mt-1 text-xs text-destructive">
                          {error}
                        </p>
                      )}
                    </td>
                  );
                })}
                <td className="py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove holding ${i + 1}`}
                    onClick={() =>
                      onChange({ ...draft, rows: draft.rows.filter((r) => r.key !== row.key) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ ...draft, rows: [...draft.rows, newRow()] })}
      >
        <Plus /> Add holding
      </Button>
    </div>
  );
}
