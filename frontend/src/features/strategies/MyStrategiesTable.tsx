import { Link } from 'react-router';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { ValidationBadge, ValidationLinks } from '@/features/validation/ValidationBadge';
import { formatDateTime, humanize } from '@/lib/format';
import { useMyStrategies, useSetStrategyActive, type Strategy } from './queries';
import { strategyKind } from './strategy-kind';

/** Each row has its own mutation, so toggling one row never blocks another. */
function ActiveToggle({ strategy }: { strategy: Strategy }) {
  const mutation = useSetStrategyActive();
  // While saving, show the value being saved; afterwards the refreshed list decides.
  const checked = mutation.isPending ? mutation.variables.isActive : strategy.is_active;
  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={checked}
        disabled={mutation.isPending}
        onCheckedChange={(isActive) => mutation.mutate({ id: strategy.id, isActive })}
        aria-label={`Active: ${strategy.name}`}
      />
      <span className="text-xs text-muted-foreground">{checked ? 'Active' : 'Inactive'}</span>
    </div>
  );
}

const columns: ColumnDef<Strategy, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <Link
        to={`/app/strategies/${row.original.id}`}
        className="font-medium text-primary hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: 'strategy_type',
    header: 'Type',
    cell: ({ row }) => humanize(row.original.strategy_type),
  },
  {
    accessorKey: 'version',
    header: 'Version',
    meta: { align: 'right' },
    cell: ({ row }) => `v${row.original.version}`,
  },
  {
    id: 'validation',
    header: 'Validation',
    accessorFn: (s) => s.validation?.status ?? '',
    cell: ({ row }) => {
      const v = row.original.validation;
      if (!v) return null;
      return (
        <div className="flex flex-col items-start gap-1">
          <ValidationBadge validation={v} />
          <ValidationLinks
            validation={v}
            strategyId={row.original.id}
            canValidate={strategyKind(row.original) !== 'python'}
          />
        </div>
      );
    },
  },
  {
    accessorKey: 'is_active',
    header: 'Status',
    cell: ({ row }) => <ActiveToggle strategy={row.original} />,
  },
  {
    accessorKey: 'updated_at',
    header: 'Updated',
    cell: ({ row }) => formatDateTime(row.original.updated_at),
  },
];

export function MyStrategiesTable() {
  const query = useMyStrategies();

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  return (
    <DataTable
      caption="My strategies"
      columns={columns}
      data={query.data}
      loading={query.isPending}
      searchPlaceholder="Search strategies"
      empty={
        <EmptyState
          title="No strategies yet"
          description="Create one with New strategy, or start from a core strategy below with Use as template."
        />
      }
    />
  );
}
