import { Calculator, FlaskConical, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { istDate } from '@/features/instruments/market-data';
import { Section } from '@/features/results/parts';
import { coreInfo } from '@/features/strategies/core-strategies';
import { ValidationBadge, ValidationLinks } from '@/features/validation/ValidationBadge';
import { formatDate, formatINR, formatNumber, formatPercent, MISSING } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AllocationDonut } from './AllocationDonut';
import {
  affectedNames,
  CALCULATION_ONLY,
  LIMIT_LABELS,
  PRICE_SOURCES,
  weightText,
  type PortfolioAccount,
  type RebalancePlan,
  type TargetPortfolio,
} from './portfolio-model';

/** "Simulated" next to a value: nothing here is a real holding or order. */
export function Simulated(props: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1 text-[10px] font-medium uppercase tracking-wide text-warning',
        props.className,
      )}
    >
      <FlaskConical aria-hidden className="size-3" />
      Simulated
    </span>
  );
}

/** The banner on every calculation: nothing is saved and no order is placed. */
export function CalculationOnly() {
  return (
    <p
      role="note"
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
    >
      <Calculator aria-hidden className="size-4 shrink-0" />
      {CALCULATION_ONLY}
    </p>
  );
}

function Stat(props: { label: string; value: string; note?: ReactNode }) {
  return (
    <div className="rounded-xl border bg-card shadow-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{props.label}</p>
        <Simulated />
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">{props.value}</p>
      {props.note && <p className="text-xs text-muted-foreground">{props.note}</p>}
    </div>
  );
}

/** Cash, invested value and total equity of the saved state. */
export function AccountStats({ account }: { account: PortfolioAccount }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3" role="group" aria-label="Saved state">
      <Stat
        label="Cash"
        value={formatINR(account.cash)}
        note={`${weightText(account.cash_weight)} of equity`}
      />
      <Stat label="Invested value" value={formatINR(account.invested_value)} />
      <Stat
        label="Total equity"
        value={formatINR(account.total_equity)}
        note={`Initial capital ${formatINR(account.initial_capital)}`}
      />
    </div>
  );
}

/** Allocation donut and holdings table of the saved state. */
export function HoldingsView({ account }: { account: PortfolioAccount }) {
  const slices = [
    ...account.holdings.map((h) => ({ label: h.asset, weight: h.weight })),
    { label: 'Cash', weight: account.cash_weight, cash: true },
  ];
  return (
    <>
      <Section
        id="allocation"
        title="Allocation weights"
        description="Each holding's value over total equity, and cash, as the API reports them."
        actions={<Simulated />}
      >
        <AllocationDonut slices={slices} label="Allocation weights of holdings and cash" />
      </Section>
      <Section
        id="holdings"
        title="Holdings"
        description="Valued at the price saved with each holding. Average price is the blended cost of saved increases."
        actions={<Simulated />}
      >
        {account.holdings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No holdings yet: everything is cash. Plan a rebalance, or enter holdings on the Edit and
            save tab.
          </p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Holdings</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Asset</th>
                  <th className="py-2 pr-2 text-right font-medium">Quantity</th>
                  <th className="py-2 pr-2 text-right font-medium">Average price</th>
                  <th className="py-2 pr-2 text-right font-medium">Valuation price</th>
                  <th className="py-2 pr-2 text-right font-medium">Value</th>
                  <th className="py-2 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody>
                {account.holdings.map((h) => (
                  <tr key={h.asset} className="border-b last:border-0">
                    <td className="py-2 pr-2 font-medium">{h.asset}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {formatNumber(h.quantity, 0)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {formatINR(h.average_price)}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatINR(h.price)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">
                      {formatINR(h.market_value)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{weightText(h.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

/** A limit's value as the user set it: money for amounts, a percentage for weights. */
const limitValue = (b: { limit: string; value: string }) =>
  b.limit.endsWith('_weight') ? formatPercent(b.value) : formatINR(b.value);

const templateName = (key: string | null | undefined) => (key ? coreInfo(key).name : MISSING);

/** Selected strategies, weights by strategy and asset, cash, binding limits, left out. */
export function TargetView({ target }: { target: TargetPortfolio }) {
  const slices = [
    ...Object.entries(target.asset_weights).map(([asset, weight]) => ({ label: asset, weight })),
    { label: 'Cash', weight: target.cash_weight, cash: true },
  ];
  const unvalidated = target.positions.filter((p) => p.validation && !p.validation.eligible);
  return (
    <div className="space-y-6">
      {target.require_validated === false && (
        <p
          role="note"
          aria-label="Unvalidated strategies included"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            {unvalidated.length > 0
              ? `Unvalidated strategies were included (for experiments): ${unvalidated.map((p) => p.name ?? p.strategy).join(', ')}.`
              : 'The switch to include unvalidated strategies was on; every allocated strategy is validated.'}
          </span>
        </p>
      )}
      <Section
        id="target-result"
        title="Target allocation"
        description={`Capital ${formatINR(target.capital)}${
          target.regime_label
            ? `; regime ${target.regime_label.code} ${target.regime_label.name}`
            : ''
        }. Split by composite score, then limited.`}
        actions={<Simulated />}
      >
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">Selected strategies</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Strategy</th>
                <th className="py-2 pr-2 font-medium">Asset</th>
                <th className="py-2 pr-2 text-right font-medium">Score</th>
                <th className="py-2 pr-2 text-right font-medium">Amount</th>
                <th className="py-2 text-right font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {target.positions.map((p) => (
                <tr key={p.strategy} className="border-b">
                  <td className="py-2 pr-2">
                    <p className="font-medium">{p.name ?? p.strategy}</p>
                    <p className="text-xs text-muted-foreground">{templateName(p.strategy_key)}</p>
                    {p.validation && <ValidationBadge validation={p.validation} className="mt-1" />}
                  </td>
                  <td className="py-2 pr-2">{p.asset ?? MISSING}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatNumber(p.score, 3)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatINR(p.amount)}</td>
                  <td className="py-2 text-right tabular-nums">{weightText(p.weight)}</td>
                </tr>
              ))}
              <tr className="border-b">
                <td className="py-2 pr-2 font-medium" colSpan={3}>
                  Cash
                </td>
                <td className="py-2 pr-2 text-right tabular-nums">
                  {formatINR(target.cash_reserve)}
                </td>
                <td className="py-2 text-right tabular-nums">{weightText(target.cash_weight)}</td>
              </tr>
              <tr>
                <td className="py-2 pr-2 font-semibold" colSpan={3}>
                  Total
                </td>
                <td className="py-2 pr-2 text-right font-semibold tabular-nums">
                  {formatINR(target.capital)}
                </td>
                <td className="py-2" />
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        id="asset-weights"
        title="Asset weights"
        description="Strategies that hold the same asset are added together (shared-asset exposure)."
        actions={<Simulated />}
      >
        <AllocationDonut slices={slices} label="Target asset weights and cash" />
      </Section>

      <Section id="binding" title="Risk limits that bound" actions={<Simulated />}>
        {target.binding_limits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None: the score-weighted split already fits every limit.
          </p>
        ) : (
          <ul className="space-y-2 text-sm" aria-label="Binding limits">
            {target.binding_limits.map((b) => (
              <li key={b.limit}>
                <span className="font-medium">{`${LIMIT_LABELS[b.limit] ?? b.limit}: ${limitValue(b)}`}</span>
                {b.affected.length > 0 && (
                  <span className="text-muted-foreground">
                    {` (${affectedNames(b, target).join(', ')})`}
                  </span>
                )}
                <p className="text-muted-foreground">{b.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {target.excluded.length > 0 && (
        <Section
          id="excluded"
          title="Not allocated"
          description="The reason comes from the backend."
        >
          <ul className="divide-y text-sm" aria-label="Not allocated">
            {target.excluded.map((e) => (
              <li key={e.strategy_id} className="py-2">
                <p className="font-medium">{e.name}</p>
                <p className="text-muted-foreground">{e.reason}</p>
                {e.validation && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <ValidationBadge validation={e.validation} />
                    <ValidationLinks validation={e.validation} strategyId={e.strategy_id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

const ACTION_CLASS: Record<string, string> = {
  BUY: 'text-success',
  SELL: 'text-destructive',
  HOLD: 'text-muted-foreground',
};

/** Current vs target per asset, the proposed trades, and the state they lead to. */
export function RebalanceView({ plan }: { plan: RebalancePlan }) {
  const ending = plan.ending_state;
  return (
    <div className="space-y-6">
      <Section
        id="plan"
        title="Current vs target"
        description={`Total equity ${formatINR(plan.current_state.total_equity)}. Trades are whole units; minimum trade value applied.`}
        actions={<Simulated />}
      >
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Rebalance plan by asset</caption>
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Asset</th>
                <th className="py-2 pr-2 text-right font-medium">Price</th>
                <th className="py-2 pr-2 text-right font-medium">Current</th>
                <th className="py-2 pr-2 text-right font-medium">Current weight</th>
                <th className="py-2 pr-2 text-right font-medium">Target</th>
                <th className="py-2 pr-2 text-right font-medium">Target weight</th>
                <th className="py-2 pr-2 font-medium">Action</th>
                <th className="py-2 pr-2 text-right font-medium">Quantity</th>
                <th className="py-2 text-right font-medium">Trade value</th>
              </tr>
            </thead>
            <tbody>
              {plan.assets.map((a) => (
                <tr key={a.asset} className="border-b last:border-0" data-asset={a.asset}>
                  <td className="py-2 pr-2 font-medium">{a.asset}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatINR(a.price)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatINR(a.current_value)}
                    <span className="block text-xs text-muted-foreground">
                      {`${formatNumber(a.current_quantity, 0)} units`}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {weightText(a.current_weight)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatINR(a.target_value)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {weightText(a.target_weight)}
                  </td>
                  <td className={cn('py-2 pr-2 font-semibold', ACTION_CLASS[a.action])}>
                    {a.action}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {formatNumber(a.trade_quantity, 0)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatINR(a.trade_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          {`Cash ${formatINR(plan.rebalancing.starting_cash)} before, ${formatINR(plan.rebalancing.ending_cash)} after the trades.`}
        </p>
      </Section>

      {plan.prices.length > 0 && (
        <Section id="prices-used" title="Prices used" actions={<Simulated />}>
          <ul className="space-y-1 text-sm" aria-label="Prices used">
            {plan.prices.map((p) => (
              <li key={p.asset}>
                <span className="font-medium">{p.asset}</span>
                <span className="tabular-nums">{` ${formatINR(p.price)}`}</span>
                <span className="text-muted-foreground">
                  {` \u2014 ${PRICE_SOURCES[p.source] ?? p.source}${
                    p.as_of ? `, ${formatDate(istDate(p.as_of))} (historical)` : ''
                  }`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {ending && (
        <Section
          id="ending"
          title="After the trades"
          description="What the portfolio would hold if every proposed trade filled at its price."
          actions={<Simulated />}
        >
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Cash</dt>
              <dd className="font-medium tabular-nums">{formatINR(ending.cash)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Invested value</dt>
              <dd className="font-medium tabular-nums">{formatINR(ending.invested_value)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total equity</dt>
              <dd className="font-medium tabular-nums">{formatINR(ending.total_equity)}</dd>
            </div>
          </dl>
        </Section>
      )}
    </div>
  );
}
