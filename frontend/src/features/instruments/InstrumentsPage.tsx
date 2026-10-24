import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { NativeSelect } from '@/components/ui/native-select';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { EXCHANGES, INSTRUMENT_TYPES } from '@/lib/enums';
import { formatNumber, MISSING } from '@/lib/format';
import { InstrumentFormDialog } from './InstrumentFormDialog';
import { exchangeLabel, instrumentTypeLabel } from './labels';
import { useInstruments, useSetInstrumentActive, type Instrument } from './queries';

function ActiveToggle({ instrument }: { instrument: Instrument }) {
  const toggle = useSetInstrumentActive();
  const checked = toggle.isPending ? !!toggle.variables?.body.is_active : instrument.is_active;
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        disabled={toggle.isPending}
        onCheckedChange={(next) => toggle.setActive(instrument, next)}
        aria-label={`Active: ${instrument.symbol}`}
      />
      <span className="text-xs text-muted-foreground">{checked ? 'Active' : 'Inactive'}</span>
    </div>
  );
}

const columns: ColumnDef<Instrument, unknown>[] = [
  {
    accessorKey: 'symbol',
    header: 'Symbol',
    cell: ({ row }) => (
      <Link
        to={`/app/instruments/${row.original.id}`}
        className="font-medium text-primary hover:underline"
      >
        {row.original.symbol}
      </Link>
    ),
  },
  { accessorKey: 'trading_symbol', header: 'Trading symbol' },
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'exchange',
    header: 'Exchange',
    cell: ({ row }) => exchangeLabel(row.original.exchange),
  },
  {
    accessorKey: 'instrument_type',
    header: 'Type',
    cell: ({ row }) => instrumentTypeLabel(row.original.instrument_type),
  },
  {
    accessorKey: 'isin',
    header: 'ISIN',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.isin || MISSING}</span>,
  },
  { accessorKey: 'lot_size', header: 'Lot size', meta: { align: 'right' } },
  {
    accessorKey: 'tick_size',
    header: 'Tick size',
    meta: { align: 'right' },
    cell: ({ row }) => formatNumber(row.original.tick_size, 2),
  },
  {
    accessorKey: 'is_active',
    header: 'Status',
    cell: ({ row }) => <ActiveToggle instrument={row.original} />,
  },
];

type StatusFilter = 'all' | 'active' | 'inactive';

/** Filters live in the address (?exchange=NSE&type=EQUITY&status=active). */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const exchange = params.get('exchange') ?? '';
  const type = params.get('type') ?? '';
  const status = (params.get('status') ?? 'all') as StatusFilter;
  const set = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  return { exchange, type, status, set };
}

function Filter(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <NativeSelect
      aria-label={props.label}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-40"
    >
      {props.children}
    </NativeSelect>
  );
}

/** /app/instruments - the shared instrument catalogue. */
export default function InstrumentsPage() {
  const query = useInstruments();
  const filters = useFilters();

  const rows = useMemo(
    () =>
      (query.data ?? []).filter(
        (i) =>
          (!filters.exchange || i.exchange === filters.exchange) &&
          (!filters.type || i.instrument_type === filters.type) &&
          (filters.status === 'all' || i.is_active === (filters.status === 'active')),
      ),
    [query.data, filters.exchange, filters.type, filters.status],
  );
  const filtered = rows.length !== (query.data ?? []).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title text-3xl">Instruments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Instruments you can backtest on. Open one to see its historical data.
          </p>
        </div>
        <InstrumentFormDialog
          target={{ kind: 'new' }}
          trigger={
            <Button>
              <Plus /> Add instrument
            </Button>
          }
        />
      </div>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <DataTable
          caption="Instruments"
          columns={columns}
          data={query.isPending ? undefined : rows}
          loading={query.isPending}
          searchPlaceholder="Search instruments"
          toolbar={
            <>
              <Filter
                label="Exchange"
                value={filters.exchange}
                onChange={(v) => filters.set('exchange', v)}
              >
                <option value="">All exchanges</option>
                {EXCHANGES.map((e) => (
                  <option key={e} value={e}>
                    {exchangeLabel(e)}
                  </option>
                ))}
              </Filter>
              <Filter label="Type" value={filters.type} onChange={(v) => filters.set('type', v)}>
                <option value="">All types</option>
                {INSTRUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {instrumentTypeLabel(t)}
                  </option>
                ))}
              </Filter>
              <Filter
                label="Status"
                value={filters.status}
                onChange={(v) => filters.set('status', v)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </Filter>
            </>
          }
          empty={
            filtered ? (
              <EmptyState
                title="No instruments match these filters"
                description="Change or clear the filters above."
              />
            ) : (
              <EmptyState
                title="No instruments yet"
                description="Add an instrument, then import its historical data from its page."
              />
            )
          }
        />
      )}
    </div>
  );
}
