import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { DateText, MoneyText } from '@/components/ui/value-text';
import { setTheme, useTheme } from '@/lib/theme';

/** Developer page (/dev/table): DataTable with sample rows. Sample values only. */

interface SampleRow {
  id: string;
  name: string;
  status: string;
  capital: number;
  created: string;
}

const STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const rows: SampleRow[] = Array.from({ length: 27 }, (_, i) => ({
  id: String(i + 1),
  name: `Sample strategy ${i + 1}`,
  status: STATUSES[i % STATUSES.length]!,
  capital: 50000 + i * 12500,
  created: new Date(Date.UTC(2026, 0, 1 + i * 7)).toISOString(),
}));

const columns: ColumnDef<SampleRow, unknown>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: (c) => <StatusBadge kind="execution" value={c.getValue<string>()} />,
  },
  {
    accessorKey: 'capital',
    header: 'Capital',
    meta: { align: 'right' },
    cell: (c) => <MoneyText value={c.getValue<number>()} />,
  },
  {
    accessorKey: 'created',
    header: 'Created',
    cell: (c) => <DateText value={c.getValue<string>()} />,
  },
];

export default function TableCheckPage() {
  const theme = useTheme();
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="page-title text-3xl">Data table</h1>
          <p className="text-sm text-muted-foreground">Developer | sample values only</p>
        </div>
        <Button variant="outline" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Light' : 'Dark'} theme
        </Button>
      </header>

      <DataTable
        caption="Sample rows"
        columns={columns}
        data={rows}
        searchPlaceholder="Search rows"
        pageSize={10}
        onRowClick={(row) => toast.info(`Clicked ${row.name}`)}
      />

      <h2 className="pt-4 text-sm font-semibold">Empty</h2>
      <DataTable caption="Empty table" columns={columns} data={[]} />

      <h2 className="pt-4 text-sm font-semibold">Loading</h2>
      <DataTable caption="Loading table" columns={columns} data={undefined} loading />
    </main>
  );
}
