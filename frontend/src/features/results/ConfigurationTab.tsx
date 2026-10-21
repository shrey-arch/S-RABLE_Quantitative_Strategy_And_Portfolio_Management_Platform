import { Link } from 'react-router';
import { providerLabel, istDate } from '@/features/instruments/market-data';
import { coreInfo } from '@/features/strategies/core-strategies';
import { RulesSummary } from '@/features/strategies/RulesSummary';
import { formatDate, formatDateTime, formatINR, formatNumber } from '@/lib/format';
import { NotAvailable, Row, Section } from './parts';
import { versionText, type ExecutionResults, type ProvenanceEntry } from './results-model';

type Symbol = (id: string) => string;

function Dataset(props: { entry: ProvenanceEntry; symbol: Symbol; index: number }) {
  const { entry } = props;
  const text = (value: string | null) => value ?? <NotAvailable reason="Not recorded." />;
  const label = entry.instrument_id
    ? props.symbol(entry.instrument_id)
    : `Dataset ${props.index + 1}`;
  return (
    <div role="group" aria-label={`Dataset ${label}`} className="rounded-lg border p-3 sm:p-4">
      <h3 className="text-sm font-semibold">{label}</h3>
      <dl className="divide-y text-sm">
        <Row label="Provider">{entry.provider ? providerLabel(entry.provider) : text(null)}</Row>
        <Row label="Frequency">
          {entry.frequency === '1D' ? 'Daily (1D)' : text(entry.frequency)}
        </Row>
        <Row label="Requested dates (UTC)">
          {entry.requested_start_date && entry.requested_end_date
            ? `${formatDate(entry.requested_start_date)} to ${formatDate(entry.requested_end_date)}`
            : text(null)}
        </Row>
        <Row label="Rows">
          {entry.row_count !== null ? formatNumber(entry.row_count, 0) : text(null)}
        </Row>
        <Row label="Cache hit">
          {entry.cache_hit === null
            ? text(null)
            : entry.cache_hit
              ? 'Yes (read from the dataset cache)'
              : 'No (loaded from stored market data)'}
        </Row>
        <Row label="Acquired at">
          {entry.data_acquired_at ? formatDateTime(entry.data_acquired_at) : text(null)}
        </Row>
        <Row label="Data fingerprint">
          <code className="font-mono text-xs break-all">{text(entry.data_fingerprint)}</code>
        </Row>
        <Row label="Data version">
          <code className="font-mono text-xs break-all">{text(entry.data_version)}</code>
        </Row>
        <Row label="Cache key">
          <code className="font-mono text-xs break-all">{text(entry.dataset_cache_key)}</code>
        </Row>
      </dl>
    </div>
  );
}

/** Configuration tab: how the run was set up, as the backend recorded it, and where its data came from. */
export function ConfigurationTab(props: { results: ExecutionResults; symbol: Symbol }) {
  const { configuration: c, summary, provenance, null_reasons } = props.results;
  const params = Object.entries(c.parameters ?? {});
  return (
    <div className="space-y-6">
      <Section id="configuration" title="Configuration" description="As recorded with the run.">
        <dl className="divide-y text-sm">
          <Row label="Strategy">
            {c.strategy_name ? (
              <Link
                to={`/app/strategies/${c.strategy_id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {c.strategy_name}
              </Link>
            ) : (
              <NotAvailable reason="The strategy was deleted." />
            )}
          </Row>
          <Row label="Template">
            {c.strategy_key ? (
              coreInfo(c.strategy_key).name
            ) : (
              <NotAvailable reason="Not recorded." />
            )}
          </Row>
          <Row label="Strategy version">
            {c.strategy_version === null ? (
              <NotAvailable reason={null_reasons.strategy_version} />
            ) : (
              <>
                {versionText(c.strategy_version)} at the run
                {c.current_strategy_version !== null &&
                  `, ${versionText(c.current_strategy_version)} now`}
              </>
            )}
          </Row>
          {c.rules ? (
            <Row label="Rules (at the run)">
              <RulesSummary config={c.rules} />
            </Row>
          ) : (
            <Row label="Parameters">
              {params.length === 0 ? (
                'Template defaults'
              ) : (
                <span className="font-mono text-xs">
                  {params.map(([k, v]) => `${k} = ${String(v)}`).join(', ')}
                </span>
              )}
            </Row>
          )}
          <Row label={c.instrument_ids.length > 1 ? 'Instruments' : 'Instrument'}>
            <ul className="space-y-0.5">
              {c.instrument_ids.map((id) => (
                <li key={id}>
                  <Link
                    to={`/app/instruments/${id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {props.symbol(id)}
                  </Link>
                </li>
              ))}
            </ul>
          </Row>
          <Row label="Timeframe">
            {c.timeframe === '1D' ? 'Daily (1D)' : c.timeframe}, historical data
          </Row>
          <Row label="Requested dates">
            {c.requested_start || c.requested_end
              ? `${c.requested_start ? formatDate(istDate(c.requested_start)) : 'All stored data'} to ${
                  c.requested_end ? formatDate(istDate(c.requested_end)) : 'the last stored bar'
                }`
              : 'All stored data'}
          </Row>
          <Row label="Bars used">
            {`${formatNumber(summary.bar_count, 0)} daily bars, ${formatDate(istDate(summary.first_bar_at))} to ${formatDate(istDate(summary.last_bar_at))}`}
          </Row>
          <Row label="Initial capital">{formatINR(c.initial_capital)}</Row>
          <Row label="Quantity per trade">
            {c.quantity !== null ? (
              formatNumber(c.quantity, 0)
            ) : (
              <NotAvailable reason="Not recorded." />
            )}
          </Row>
          <Row label="Slippage">
            {c.slippage_bps !== null ? (
              `${formatNumber(c.slippage_bps, 2)} bps`
            ) : (
              <NotAvailable reason="Not recorded." />
            )}
          </Row>
          <Row label="Brokerage">
            {c.brokerage_rate !== null ? (
              `${formatNumber(c.brokerage_rate * 100, 4)}% of trade value`
            ) : (
              <NotAvailable reason="Not recorded." />
            )}
          </Row>
          <Row label="Engine version">
            {c.engine_version ?? <NotAvailable reason={null_reasons.engine_version} />}
          </Row>
          <Row label="Run id">
            <code className="font-mono text-xs">{props.results.execution_id}</code>
          </Row>
        </dl>
      </Section>

      <Section
        id="provenance"
        title="Data provenance"
        description="Where the run's prices came from, as recorded when it ran."
      >
        {provenance.datasets.length === 0 ? (
          <p className="text-sm">
            <NotAvailable reason="This run did not record where its data came from (runs made before data provenance was added)." />
          </p>
        ) : (
          <div className="space-y-3">
            {provenance.aligned_rows !== null && (
              <p className="text-sm text-muted-foreground">
                {formatNumber(provenance.aligned_rows, 0)} bars shared by all instruments were used.
              </p>
            )}
            {provenance.datasets.map((entry, i) => (
              <Dataset
                key={entry.instrument_id ?? i}
                entry={entry}
                symbol={props.symbol}
                index={i}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
