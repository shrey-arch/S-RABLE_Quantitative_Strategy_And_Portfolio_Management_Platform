import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { downloadCsv, toCsv, type CsvValue } from '@/lib/csv';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input } from './input';
import { EmptyState, LoadingState } from './states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

export type { ColumnDef } from '@tanstack/react-table';

/** Optional per-column settings, set through `meta` in a column definition. */
export interface ColumnMeta {
  /** Right-align numbers and money. */
  align?: 'right';
  /** The column's value in a CSV export (the raw API value, unformatted). Columns without it are left out. */
  csv?(row: never): CsvValue;
  /** CSV header; defaults to the column header when that is text. */
  csvHeader?: string;
}

/**
 * Table with sorting (click a header), search across all columns and pages.
 * All of this happens in the browser on the rows already loaded.
 *
 *   <DataTable caption="Strategies" columns={columns} data={query.data} loading={query.isPending} />
 */
export function DataTable<T>(props: {
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  /** Accessible name of the table (read by screen readers). */
  caption: string;
  loading?: boolean;
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  toolbar?: ReactNode;
  /** Adds an "Export CSV" button that saves the rows as displayed (search and sort applied, all pages). */
  csvFileName?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState('');

  const table = useReactTable({
    data: props.data ?? [],
    columns: props.columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: props.pageSize ?? 20 } },
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.getState().pagination;
  const alignOf = (meta: unknown) =>
    (meta as ColumnMeta | undefined)?.align === 'right' ? 'text-right' : '';

  const exportCsv = () => {
    const columns = table
      .getAllLeafColumns()
      .map((column) => ({ column, meta: column.columnDef.meta as ColumnMeta | undefined }))
      .filter(({ meta }) => meta?.csv);
    const header = columns.map(
      ({ column, meta }) =>
        meta?.csvHeader ??
        (typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id),
    );
    const rows = table
      .getPrePaginationRowModel()
      .rows.map((row) => columns.map(({ meta }) => meta!.csv!(row.original as never)));
    downloadCsv(props.csvFileName!, toCsv(header, rows));
  };

  return (
    <div className="space-y-3">
      {(props.searchPlaceholder || props.toolbar || props.csvFileName) && (
        <div className="flex flex-wrap items-center gap-2">
          {props.searchPlaceholder && (
            <div className="relative w-full max-w-xs">
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={props.searchPlaceholder}
                aria-label={props.searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}
          {props.toolbar}
          {props.csvFileName && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={exportCsv}
              disabled={props.loading || total === 0}
            >
              <Download /> Export CSV
            </Button>
          )}
        </div>
      )}

      {props.loading ? (
        <LoadingState />
      ) : !props.data?.length ? (
        (props.empty ?? <EmptyState title="No records yet" />)
      ) : (
        <>
          <div className="rounded-lg border bg-card">
            <Table>
              <caption className="sr-only">{props.caption}</caption>
              <TableHeader>
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const align = alignOf(header.column.columnDef.meta);
                      return (
                        <TableHead
                          key={header.id}
                          className={align}
                          aria-sort={
                            sorted === 'asc'
                              ? 'ascending'
                              : sorted === 'desc'
                                ? 'descending'
                                : undefined
                          }
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              type="button"
                              onClick={header.column.getToggleSortingHandler()}
                              className={cn(
                                'inline-flex items-center gap-1 hover:text-foreground',
                                align && 'flex-row-reverse',
                              )}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {sorted === 'asc' ? (
                                <ArrowUp className="size-3.5" />
                              ) : sorted === 'desc' ? (
                                <ArrowDown className="size-3.5" />
                              ) : (
                                <ArrowUpDown className="size-3.5 opacity-40" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={props.columns.length}
                      className="py-8 text-center text-muted-foreground"
                    >
                      No rows match &quot;{search}&quot;.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      onClick={
                        props.onRowClick ? () => props.onRowClick?.(row.original) : undefined
                      }
                      onKeyDown={
                        props.onRowClick
                          ? (e) => e.key === 'Enter' && props.onRowClick?.(row.original)
                          : undefined
                      }
                      tabIndex={props.onRowClick ? 0 : undefined}
                      className={cn(props.onRowClick && 'cursor-pointer')}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(alignOf(cell.column.columnDef.meta), 'tabular-nums')}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {table.getPageCount() > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular-nums">
                {pageIndex * pageSize + 1}-{Math.min((pageIndex + 1) * pageSize, total)} of {total}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
