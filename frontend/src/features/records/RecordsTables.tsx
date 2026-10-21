import { Info } from 'lucide-react';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/states';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A column header with "how it is computed" from the backend formula. */
export function Explained(props: { label: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {props.label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`How ${props.label} is computed`}
            className="text-muted-foreground hover:text-foreground"
          >
            <Info className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{props.text}</TooltipContent>
      </Tooltip>
    </span>
  );
}

export function RecordTable<T>(props: {
  caption: string;
  columns: ColumnDef<T, unknown>[];
  data: T[] | undefined;
  loading: boolean;
  onOpen: (row: T) => void;
  csvFileName: string;
}) {
  return (
    <DataTable
      caption={props.caption}
      columns={props.columns}
      data={props.data}
      loading={props.loading}
      onRowClick={props.onOpen}
      csvFileName={props.csvFileName}
      empty={
        <EmptyState
          title="No records match"
          description="Records are stored when a backtest completes. Change the filters, or store an older run's records from its results page."
        />
      }
    />
  );
}
