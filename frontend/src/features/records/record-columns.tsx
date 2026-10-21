import type { ColumnDef } from '@/components/ui/data-table';
import { MoneyText, NumberText } from '@/components/ui/value-text';
import { formatDateTime, humanize, MISSING } from '@/lib/format';
import { FORMULAS, type Order, type Position, type Trade } from './records-model';
import { Explained } from './RecordsTables';

/** A record with the names of its execution and instrument (for display, sorting and search). */
export type Named<T> = T & { execution_name: string; instrument_name: string };

export function named<T extends { execution_id?: string | null; instrument_id?: string | null }>(
  rows: T[] | undefined,
  names: Names,
): Named<T>[] | undefined {
  return rows?.map((r) => ({
    ...r,
    execution_name: names.execution(r.execution_id),
    instrument_name: names.instrument(r.instrument_id),
  }));
}

/** Names for ids, from the lists already loaded. */
export interface Names {
  execution: (id: string | null | undefined) => string;
  instrument: (id: string | null | undefined) => string;
}

const right = { align: 'right' as const };
const time = (value: string | null | undefined) =>
  value ? <span className="whitespace-nowrap">{formatDateTime(value)}</span> : MISSING;

const explained = (label: string, text: string) => () => <Explained label={label} text={text} />;

export function orderColumns(): ColumnDef<Named<Order>, unknown>[] {
  return [
    {
      accessorKey: 'order_timestamp',
      header: 'Time',
      cell: ({ row }) => time(row.original.order_timestamp),
      meta: { csv: (r: Named<Order>) => r.order_timestamp },
    },
    {
      header: 'Execution',
      accessorKey: 'execution_name',
      meta: { csv: (r: Named<Order>) => r.execution_id },
    },
    {
      header: 'Instrument',
      accessorKey: 'instrument_name',
      meta: { csv: (r: Named<Order>) => r.instrument_id },
    },
    {
      accessorKey: 'order_type',
      header: 'Type',
      cell: ({ row }) => humanize(row.original.order_type),
      meta: { csv: (r: Named<Order>) => r.order_type },
    },
    { accessorKey: 'order_side', header: 'Side', meta: { csv: (r: Named<Order>) => r.order_side } },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => humanize(row.original.status),
      meta: { csv: (r: Named<Order>) => r.status },
    },
    {
      accessorKey: 'quantity',
      header: 'Quantity',
      cell: ({ row }) => <NumberText value={row.original.quantity} decimals={0} />,
      meta: { ...right, csv: (r: Named<Order>) => r.quantity },
    },
    {
      accessorKey: 'filled_quantity',
      header: 'Filled',
      cell: ({ row }) => <NumberText value={row.original.filled_quantity} decimals={0} />,
      meta: { ...right, csv: (r: Named<Order>) => r.filled_quantity },
    },
    {
      accessorKey: 'price',
      header: explained('Price', FORMULAS.orderPrice),
      enableSorting: false,
      cell: ({ row }) => <NumberText value={row.original.price} />,
      meta: { ...right, csv: (r: Named<Order>) => r.price, csvHeader: 'Price' },
    },
    {
      accessorKey: 'average_fill_price',
      header: 'Average fill price',
      cell: ({ row }) => <NumberText value={row.original.average_fill_price} />,
      meta: { ...right, csv: (r: Named<Order>) => r.average_fill_price },
    },
  ];
}

export function tradeColumns(): ColumnDef<Named<Trade>, unknown>[] {
  return [
    {
      accessorKey: 'trade_timestamp',
      header: 'Time',
      cell: ({ row }) => time(row.original.trade_timestamp),
      meta: { csv: (r: Named<Trade>) => r.trade_timestamp },
    },
    {
      header: 'Execution',
      accessorKey: 'execution_name',
      meta: { csv: (r: Named<Trade>) => r.execution_id },
    },
    {
      header: 'Instrument',
      accessorKey: 'instrument_name',
      meta: { csv: (r: Named<Trade>) => r.instrument_id },
    },
    { accessorKey: 'order_side', header: 'Side', meta: { csv: (r: Named<Trade>) => r.order_side } },
    {
      accessorKey: 'executed_quantity',
      header: 'Executed quantity',
      cell: ({ row }) => <NumberText value={row.original.executed_quantity} decimals={0} />,
      meta: { ...right, csv: (r: Named<Trade>) => r.executed_quantity },
    },
    {
      accessorKey: 'executed_price',
      header: 'Executed price',
      cell: ({ row }) => <NumberText value={row.original.executed_price} />,
      meta: { ...right, csv: (r: Named<Trade>) => r.executed_price },
    },
    {
      accessorKey: 'brokerage',
      header: 'Brokerage',
      cell: ({ row }) => <MoneyText value={row.original.brokerage} />,
      meta: { ...right, csv: (r: Named<Trade>) => r.brokerage },
    },
    {
      accessorKey: 'total_charges',
      header: explained('Total charges', FORMULAS.charges),
      enableSorting: false,
      cell: ({ row }) => <MoneyText value={row.original.total_charges} />,
      meta: { ...right, csv: (r: Named<Trade>) => r.total_charges, csvHeader: 'Total charges' },
    },
    {
      accessorKey: 'order_id',
      header: 'Parent order',
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.order_id.slice(0, 8)}</span>
      ),
      meta: { csv: (r: Named<Trade>) => r.order_id },
    },
  ];
}

export function positionColumns(): ColumnDef<Named<Position>, unknown>[] {
  return [
    {
      header: 'Execution',
      accessorKey: 'execution_name',
      meta: { csv: (r: Named<Position>) => r.execution_id },
    },
    {
      header: 'Instrument',
      accessorKey: 'instrument_name',
      meta: { csv: (r: Named<Position>) => r.instrument_id },
    },
    {
      accessorKey: 'direction',
      header: 'Direction',
      cell: ({ row }) => humanize(row.original.direction),
      meta: { csv: (r: Named<Position>) => r.direction },
    },
    {
      accessorKey: 'quantity',
      header: 'Quantity',
      cell: ({ row }) => <NumberText value={row.original.quantity} decimals={0} />,
      meta: { ...right, csv: (r: Named<Position>) => r.quantity },
    },
    {
      accessorKey: 'average_price',
      header: explained('Average price', FORMULAS.averagePrice),
      enableSorting: false,
      cell: ({ row }) => <NumberText value={row.original.average_price} />,
      meta: { ...right, csv: (r: Named<Position>) => r.average_price, csvHeader: 'Average price' },
    },
    {
      accessorKey: 'current_price',
      header: 'Current price',
      cell: ({ row }) => <NumberText value={row.original.current_price} />,
      meta: { ...right, csv: (r: Named<Position>) => r.current_price },
    },
    {
      accessorKey: 'market_value',
      header: explained('Market value', FORMULAS.marketValue),
      enableSorting: false,
      cell: ({ row }) => <MoneyText value={row.original.market_value} />,
      meta: { ...right, csv: (r: Named<Position>) => r.market_value, csvHeader: 'Market value' },
    },
    {
      accessorKey: 'realized_pnl',
      header: explained('Realised P&L', FORMULAS.realized),
      enableSorting: false,
      cell: ({ row }) => <MoneyText value={row.original.realized_pnl} colored />,
      meta: { ...right, csv: (r: Named<Position>) => r.realized_pnl, csvHeader: 'Realised P&L' },
    },
    {
      accessorKey: 'unrealized_pnl',
      header: explained('Unrealised P&L', FORMULAS.unrealized),
      enableSorting: false,
      cell: ({ row }) => <MoneyText value={row.original.unrealized_pnl} colored />,
      meta: {
        ...right,
        csv: (r: Named<Position>) => r.unrealized_pnl,
        csvHeader: 'Unrealised P&L',
      },
    },
    {
      accessorKey: 'position_status',
      header: 'Status',
      cell: ({ row }) => humanize(row.original.position_status),
      meta: { csv: (r: Named<Position>) => r.position_status },
    },
    {
      accessorKey: 'closed_at',
      header: 'Closed',
      cell: ({ row }) => time(row.original.closed_at),
      meta: { csv: (r: Named<Position>) => r.closed_at },
    },
  ];
}
