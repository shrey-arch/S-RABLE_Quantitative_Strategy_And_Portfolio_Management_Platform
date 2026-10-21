import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { ErrorState } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useExecutions } from '@/features/backtests/queries';
import { useInstruments } from '@/features/instruments/queries';
import { humanize } from '@/lib/format';
import { RecordDrawer } from './RecordDrawer';
import {
  DIRECTIONS,
  filtersFor,
  isRecordTab,
  MAINTENANCE_LABEL,
  parseRecordRef,
  RECORD_TAB_LABELS,
  RECORD_TABS,
  recordRef,
  SIDES,
  statusesFor,
  TAB_FILTERS,
  type FilterParam,
  type RecordRef,
  type RecordTab,
} from './records-model';
import { named, orderColumns, positionColumns, tradeColumns, type Names } from './record-columns';
import { RecordTable } from './RecordsTables';
import { useNames } from './use-names';
import { useOrders, usePositions, useTrades } from './queries';

function Filters(props: { tab: RecordTab; names: Names }) {
  const [params, setParams] = useSearchParams();
  const executions = useExecutions({ execution_type: 'BACKTEST' });
  const instruments = useInstruments();
  const set = (key: FilterParam, value: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const shown = TAB_FILTERS[props.tab];
  const statuses = statusesFor(props.tab);
  const select = (key: FilterParam, label: string, options: [string, string][]) => (
    <div className="space-y-1">
      <Label htmlFor={`filter-${key}`} className="text-xs">
        {label}
      </Label>
      <NativeSelect
        id={`filter-${key}`}
        value={params.get(key) ?? ''}
        onChange={(e) => set(key, e.target.value)}
        className="w-full"
      >
        <NativeSelectOption value="">All</NativeSelectOption>
        {options.map(([value, text]) => (
          <NativeSelectOption key={value} value={value}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
  return (
    <div
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4"
      role="group"
      aria-label="Filters"
    >
      {select(
        'execution',
        'Execution',
        (executions.data ?? []).map((e) => [e.id, props.names.execution(e.id)]),
      )}
      {select(
        'instrument',
        'Instrument',
        (instruments.data ?? []).map((i) => [i.id, i.symbol]),
      )}
      {shown.includes('status') &&
        select(
          'status',
          'Status',
          statuses.map((s) => [s, humanize(s)]),
        )}
      {shown.includes('side') &&
        select(
          'side',
          'Side',
          SIDES.map((s) => [s, s]),
        )}
      {shown.includes('direction') &&
        select(
          'direction',
          'Direction',
          DIRECTIONS.map((d) => [d, humanize(d)]),
        )}
      {(['from', 'to'] as const).map((key) => (
        <div key={key} className="space-y-1">
          <Label htmlFor={`filter-${key}`} className="text-xs">
            {key === 'from' ? 'From (IST day)' : 'To (IST day)'}
          </Label>
          <input
            id={`filter-${key}`}
            type="date"
            value={params.get(key) ?? ''}
            onChange={(e) => set(key, e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          />
        </div>
      ))}
      <div className="flex items-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setParams(
              (prev) => {
                const p = new URLSearchParams(prev);
                for (const key of [
                  'execution',
                  'instrument',
                  'status',
                  'side',
                  'direction',
                  'from',
                  'to',
                ])
                  p.delete(key);
                return p;
              },
              { replace: true },
            )
          }
        >
          Clear filters
        </Button>
      </div>
    </div>
  );
}

function List(props: { tab: RecordTab; names: Names; onOpen: (ref: RecordRef) => void }) {
  const [params] = useSearchParams();
  const filters = filtersFor(props.tab, params);
  const orders = useOrders(filters, props.tab === 'orders');
  const trades = useTrades(filters, props.tab === 'trades');
  const positions = usePositions(filters, props.tab === 'positions');
  const query = props.tab === 'orders' ? orders : props.tab === 'trades' ? trades : positions;
  // Rows carry the run and instrument names, and are rebuilt when the names arrive.
  const { names } = props;
  const orderRows = useMemo(() => named(orders.data, names), [orders.data, names]);
  const tradeRows = useMemo(() => named(trades.data, names), [trades.data, names]);
  const positionRows = useMemo(() => named(positions.data, names), [positions.data, names]);
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (props.tab === 'orders')
    return (
      <RecordTable
        caption="Orders"
        columns={orderColumns()}
        data={orderRows}
        loading={orders.isPending}
        onOpen={(o) => props.onOpen({ kind: 'order', id: o.id })}
        csvFileName="simulated-orders.csv"
      />
    );
  if (props.tab === 'trades')
    return (
      <RecordTable
        caption="Trades"
        columns={tradeColumns()}
        data={tradeRows}
        loading={trades.isPending}
        onOpen={(t) => props.onOpen({ kind: 'trade', id: t.id })}
        csvFileName="simulated-trades.csv"
      />
    );
  return (
    <RecordTable
      caption="Positions"
      columns={positionColumns()}
      data={positionRows}
      loading={positions.isPending}
      onOpen={(p) => props.onOpen({ kind: 'position', id: p.id })}
      csvFileName="simulated-positions.csv"
    />
  );
}

/** /app/records - simulated orders, trades and positions of the user's backtests. */
export default function RecordsPage() {
  const [params, setParams] = useSearchParams();
  const value = params.get('tab');
  const tab = isRecordTab(value) ? value : 'orders';
  const advanced = params.get('advanced') === '1';
  const record = parseRecordRef(params.get('record'));
  const names = useNames();
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Trading Records</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            The simulated orders, trades and positions stored from your backtests, and how they link
            to each run. Open a row for its chain: execution, order, trades and position. There is
            no order entry: nothing here is sent to a broker.
          </p>
          <SimulationLabel />
        </div>
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <Switch
            id="advanced"
            checked={advanced}
            onCheckedChange={(on) => update({ advanced: on ? '1' : null })}
          />
          <Label htmlFor="advanced" className="text-sm">
            Advanced: record maintenance
          </Label>
        </div>
      </div>
      {advanced && (
        <p
          role="note"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          {`${MAINTENANCE_LABEL}. Open a record to change an order's status or delete a record; each change asks for confirmation.`}
        </p>
      )}
      <Tabs
        value={tab}
        onValueChange={(t) =>
          update({ tab: t === 'orders' ? null : t, status: null, side: null, direction: null })
        }
      >
        <TabsList aria-label="Record types">
          {RECORD_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {RECORD_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {RECORD_TABS.map((t) => (
          <TabsContent key={t} value={t} className="space-y-4">
            <Filters tab={t} names={names} />
            <List tab={t} names={names} onOpen={(ref) => update({ record: recordRef(ref) })} />
          </TabsContent>
        ))}
      </Tabs>
      <RecordDrawer
        record={record}
        onOpen={(ref) => update({ record: recordRef(ref) })}
        onClose={() => update({ record: null })}
        advanced={advanced}
        names={names}
      />
    </div>
  );
}
