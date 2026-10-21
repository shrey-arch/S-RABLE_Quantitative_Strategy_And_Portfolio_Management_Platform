import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { EmptyState } from '@/components/ui/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MoneyText, NumberText, PercentText } from '@/components/ui/value-text';
import { formatDate, formatINR, humanize } from '@/lib/format';
import { istDate } from '@/features/instruments/market-data';
import { Section } from './parts';
import type { ExecutionResults, RoundTrip, SimulatedFill, SimulatedOrder } from './results-model';

type Symbol = (id: string) => string;
const right = { align: 'right' as const };
const day = (timestamp: string) => formatDate(istDate(timestamp));

interface TradeRow extends RoundTrip {
  n: number;
  symbol: string;
}

const tradeColumns: ColumnDef<TradeRow, unknown>[] = [
  {
    accessorKey: 'n',
    header: '#',
    meta: { ...right, csv: (r: TradeRow) => r.n, csvHeader: 'trade' },
  },
  { accessorKey: 'symbol', header: 'Instrument', meta: { csv: (r: TradeRow) => r.symbol } },
  {
    accessorKey: 'direction',
    header: 'Side',
    cell: ({ row }) => humanize(row.original.direction),
    meta: { csv: (r: TradeRow) => r.direction, csvHeader: 'direction' },
  },
  {
    accessorKey: 'quantity',
    header: 'Quantity',
    cell: ({ row }) => <NumberText value={row.original.quantity} decimals={0} />,
    meta: { ...right, csv: (r: TradeRow) => r.quantity },
  },
  {
    accessorKey: 'entry_timestamp',
    header: 'Entry',
    cell: ({ row }) => (
      <span className="whitespace-nowrap">{day(row.original.entry_timestamp)}</span>
    ),
    meta: { csv: (r: TradeRow) => r.entry_timestamp, csvHeader: 'entry_time' },
  },
  {
    accessorKey: 'entry_price',
    header: 'Entry price',
    cell: ({ row }) => <NumberText value={row.original.entry_price} />,
    meta: { ...right, csv: (r: TradeRow) => r.entry_price },
  },
  {
    id: 'exit',
    header: 'Exit',
    accessorFn: (r) => r.exit_timestamp ?? '',
    cell: ({ row }) =>
      row.original.is_open ? (
        <span className="text-muted-foreground">Still open</span>
      ) : (
        <span className="whitespace-nowrap">{day(row.original.exit_timestamp!)}</span>
      ),
    meta: { csv: (r: TradeRow) => r.exit_timestamp, csvHeader: 'exit_time' },
  },
  {
    accessorKey: 'exit_price',
    header: 'Exit price',
    cell: ({ row }) =>
      row.original.is_open ? (
        <span className="text-xs text-muted-foreground">at last close</span>
      ) : (
        <NumberText value={row.original.exit_price} />
      ),
    meta: { ...right, csv: (r: TradeRow) => r.exit_price },
  },
  {
    accessorKey: 'gross_pnl',
    header: 'Gross P&L',
    cell: ({ row }) => (
      <MoneyText
        value={row.original.gross_pnl}
        colored
        missingReason="No stored price at the last bar to value the open position."
      />
    ),
    meta: { ...right, csv: (r: TradeRow) => r.gross_pnl },
  },
  {
    accessorKey: 'charges',
    header: 'Charges',
    cell: ({ row }) => <MoneyText value={row.original.charges} />,
    meta: { ...right, csv: (r: TradeRow) => r.charges },
  },
  {
    accessorKey: 'net_pnl',
    header: 'Net P&L',
    cell: ({ row }) => (
      <MoneyText
        value={row.original.net_pnl}
        colored
        missingReason="No stored price at the last bar to value the open position."
      />
    ),
    meta: { ...right, csv: (r: TradeRow) => r.net_pnl },
  },
  {
    accessorKey: 'return',
    header: 'Return',
    cell: ({ row }) => <PercentText value={row.original.return} colored />,
    meta: { ...right, csv: (r: TradeRow) => r.return },
  },
];

/** Trades tab: one row per trade (open to flat), exportable as CSV. */
export function TradesTab(props: { results: ExecutionResults; symbol: Symbol }) {
  const { results } = props;
  const rows: TradeRow[] = results.round_trips.map((t, i) => ({
    ...t,
    n: i + 1,
    symbol: props.symbol(t.instrument_id),
  }));
  return (
    <Section
      id="trade-log"
      title="Trade log"
      description="Each row is one trade, from opening a position to being flat again. Prices are average fill prices; P&L is after charges. A trade still open at the end is valued at the last close. Export CSV saves the rows as shown (search and sort applied), with the exact API values."
    >
      <DataTable
        caption="Trade log"
        columns={tradeColumns}
        data={rows}
        searchPlaceholder="Search trades"
        csvFileName={`backtest-${results.execution_id.slice(0, 8)}-trades.csv`}
        empty={
          <EmptyState
            title="No trades"
            description="The strategy made no trades in this run. The capital stayed in cash; this is a valid result, not an error."
          />
        }
      />
    </Section>
  );
}

type OrderRow = SimulatedOrder & { symbol: string };
type FillRow = SimulatedFill & { symbol: string };

const orderColumns: ColumnDef<OrderRow, unknown>[] = [
  {
    accessorKey: 'timestamp',
    header: 'Bar',
    cell: ({ row }) => <span className="whitespace-nowrap">{day(row.original.timestamp)}</span>,
    meta: { csv: (r: OrderRow) => r.timestamp },
  },
  { accessorKey: 'symbol', header: 'Instrument', meta: { csv: (r: OrderRow) => r.symbol } },
  { accessorKey: 'side', header: 'Side', meta: { csv: (r: OrderRow) => r.side } },
  {
    accessorKey: 'order_type',
    header: 'Type',
    cell: ({ row }) => humanize(row.original.order_type),
    meta: { csv: (r: OrderRow) => r.order_type },
  },
  {
    accessorKey: 'quantity',
    header: 'Quantity',
    cell: ({ row }) => <NumberText value={row.original.quantity} decimals={0} />,
    meta: { ...right, csv: (r: OrderRow) => r.quantity },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => humanize(row.original.status),
    meta: { csv: (r: OrderRow) => r.status },
  },
  {
    accessorKey: 'reference_price',
    header: 'Bar close',
    cell: ({ row }) => (
      <NumberText
        value={row.original.reference_price}
        missingReason="The bar's price is no longer stored."
      />
    ),
    meta: { ...right, csv: (r: OrderRow) => r.reference_price },
  },
  {
    accessorKey: 'fill_price',
    header: 'Fill price',
    cell: ({ row }) => <NumberText value={row.original.fill_price} />,
    meta: { ...right, csv: (r: OrderRow) => r.fill_price },
  },
];

const fillColumns: ColumnDef<FillRow, unknown>[] = [
  {
    accessorKey: 'timestamp',
    header: 'Bar',
    cell: ({ row }) => <span className="whitespace-nowrap">{day(row.original.timestamp)}</span>,
    meta: { csv: (r: FillRow) => r.timestamp },
  },
  { accessorKey: 'symbol', header: 'Instrument', meta: { csv: (r: FillRow) => r.symbol } },
  { accessorKey: 'side', header: 'Side', meta: { csv: (r: FillRow) => r.side } },
  {
    accessorKey: 'quantity',
    header: 'Quantity',
    cell: ({ row }) => <NumberText value={row.original.quantity} decimals={0} />,
    meta: { ...right, csv: (r: FillRow) => r.quantity },
  },
  {
    accessorKey: 'price',
    header: 'Price',
    cell: ({ row }) => <NumberText value={row.original.price} />,
    meta: { ...right, csv: (r: FillRow) => r.price },
  },
  {
    accessorKey: 'brokerage',
    header: 'Brokerage',
    cell: ({ row }) => <MoneyText value={row.original.brokerage} />,
    meta: { ...right, csv: (r: FillRow) => r.brokerage },
  },
  {
    accessorKey: 'total_charges',
    header: 'Charges',
    cell: ({ row }) => <MoneyText value={row.original.total_charges} />,
    meta: { ...right, csv: (r: FillRow) => r.total_charges },
  },
  {
    accessorKey: 'realized_pnl',
    header: 'Realised P&L',
    cell: ({ row }) => <MoneyText value={row.original.realized_pnl} colored />,
    meta: { ...right, csv: (r: FillRow) => r.realized_pnl },
  },
  {
    id: 'closed_opened',
    header: 'Closed / opened',
    accessorFn: (r) => r.closed_quantity,
    enableSorting: false,
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.closed_quantity} / {row.original.opened_quantity}
      </span>
    ),
    meta: { ...right },
  },
];

/** Records tab: the run's simulated orders, fills and end positions. Nothing was traded. */
export function RecordsTab(props: { results: ExecutionResults; symbol: Symbol }) {
  const { records, execution_id } = props.results;
  const short = execution_id.slice(0, 8);
  const orders = records.orders.map((o) => ({ ...o, symbol: props.symbol(o.instrument_id) }));
  const fills = records.fills.map((f) => ({ ...f, symbol: props.symbol(f.instrument_id) }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/50 p-3 text-sm">
        <SimulationLabel />
        <span>
          What the simulation recorded for this run, from its stored result. No order was sent to a
          broker.
        </span>
      </div>

      <Section
        id="orders"
        title="Simulated orders"
        description="One market order per signal change, sent at the bar's close and filled on that bar (with slippage)."
      >
        <DataTable
          caption="Simulated orders"
          columns={orderColumns}
          data={orders}
          csvFileName={`backtest-${short}-orders.csv`}
          empty={<EmptyState title="No orders" description="The strategy made no trades." />}
        />
      </Section>

      <Section
        id="fills"
        title="Simulated fills"
        description="Realised P&L is before charges; charges are listed separately. A fill can close one position and open the next."
      >
        <DataTable
          caption="Simulated fills"
          columns={fillColumns}
          data={fills}
          csvFileName={`backtest-${short}-fills.csv`}
          empty={<EmptyState title="No fills" description="The strategy made no trades." />}
        />
      </Section>

      <Section
        id="positions"
        title="Positions at the end"
        description={`Held at the last bar, valued at its close. Cash at the end: ${formatINR(records.ending_cash)}.`}
      >
        {records.positions.length === 0 ? (
          <EmptyState
            title="No open positions"
            description="Everything was in cash at the last bar."
          />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <caption className="sr-only">Positions at the end</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Instrument</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Average price</TableHead>
                  <TableHead className="text-right">Last close</TableHead>
                  <TableHead className="text-right">Market value</TableHead>
                  <TableHead className="text-right">Unrealised P&amp;L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.positions.map((p) => (
                  <TableRow key={p.instrument_id}>
                    <TableCell>{props.symbol(p.instrument_id)}</TableCell>
                    <TableCell>{humanize(p.direction)}</TableCell>
                    <TableCell className="text-right">
                      <NumberText value={p.quantity} decimals={0} />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberText value={p.average_price} />
                    </TableCell>
                    <TableCell className="text-right">
                      <NumberText
                        value={p.last_price}
                        missingReason="No stored price at the last bar."
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText
                        value={p.market_value}
                        missingReason="No stored price at the last bar."
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText
                        value={p.unrealized_pnl}
                        colored
                        missingReason="No stored price at the last bar."
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
