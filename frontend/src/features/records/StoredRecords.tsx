import { Database } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { MoneyText, NumberText } from '@/components/ui/value-text';
import { Section } from '@/features/results/parts';
import { formatDateTime, humanize, MISSING } from '@/lib/format';
import { RecordDrawer } from './RecordDrawer';
import type { RecordRef } from './records-model';
import { useOrders, usePositions, useRecordCounts, useStoreRecords, useTrades } from './queries';
import { useNames } from './use-names';

const when = (value: string | null | undefined) => (value ? formatDateTime(value) : MISSING);

/** Drawer listing one run's stored records as a chain: orders with their trades, then positions. */
function ExecutionRecordsDrawer(props: {
  executionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecord: (ref: RecordRef) => void;
}) {
  const filter = { execution_id: props.executionId };
  const orders = useOrders(filter, props.open);
  const trades = useTrades(filter, props.open);
  const positions = usePositions(filter, props.open);
  const names = useNames();
  const failed = [orders, trades, positions].find((q) => q.isError);
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-5 sm:max-w-xl">
        <SheetTitle className="text-lg">Trading records of this run</SheetTitle>
        <SheetDescription className="mb-4">
          {`${names.execution(props.executionId)}. Execution \u2192 orders \u2192 trades; execution and instrument \u2192 position. Simulated.`}
        </SheetDescription>
        {failed ? (
          <ErrorState error={failed.error} />
        ) : !orders.data || !trades.data || !positions.data ? (
          <LoadingState rows={5} />
        ) : (
          <div className="space-y-5">
            <section aria-label="Orders and their trades">
              <h3 className="mb-2 font-medium">{`Orders (${orders.data.length})`}</h3>
              <ol className="space-y-2">
                {orders.data.map((o) => (
                  <li key={o.id} className="rounded-lg border p-3 text-sm">
                    <button
                      type="button"
                      className="text-left font-medium text-primary hover:underline"
                      onClick={() => props.onRecord({ kind: 'order', id: o.id })}
                    >
                      {`${o.order_side} ${o.quantity} ${names.instrument(o.instrument_id)} \u00b7 ${humanize(o.status)} \u00b7 ${when(o.order_timestamp)}`}
                    </button>
                    <ul className="mt-1 space-y-0.5 pl-4 text-muted-foreground">
                      {trades.data
                        .filter((t) => t.order_id === o.id)
                        .map((t) => (
                          <li key={t.id}>
                            <button
                              type="button"
                              className="hover:underline"
                              onClick={() => props.onRecord({ kind: 'trade', id: t.id })}
                            >
                              {`Trade: ${t.executed_quantity} @ `}
                              <NumberText value={t.executed_price} />
                              {', charges '}
                              <MoneyText value={t.total_charges} />
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-label="Positions">
              <h3 className="mb-2 font-medium">{`Positions (${positions.data.length})`}</h3>
              <ul className="space-y-2">
                {positions.data.map((p) => (
                  <li key={p.id} className="rounded-lg border p-3 text-sm">
                    <button
                      type="button"
                      className="text-left font-medium text-primary hover:underline"
                      onClick={() => props.onRecord({ kind: 'position', id: p.id })}
                    >
                      {`${names.instrument(p.instrument_id)} \u00b7 ${humanize(p.direction)} ${p.quantity} \u00b7 ${humanize(p.position_status)}`}
                    </button>
                    <p className="text-muted-foreground">
                      {'Realised '}
                      <MoneyText value={p.realized_pnl} />
                      {' \u00b7 unrealised '}
                      <MoneyText value={p.unrealized_pnl} />
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Results page, Records tab: whether this run's trading records are stored, a
 * drawer with them, and a link to Trading Records filtered to the run.
 */
export function StoredRecords({ executionId }: { executionId: string }) {
  const counts = useRecordCounts(executionId);
  const store = useStoreRecords(executionId);
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<RecordRef | null>(null);
  const names = useNames();
  return (
    <Section
      id="stored-records"
      title="Trading records"
      description="The run's simulated orders, trades and positions as stored records, linked to this execution."
      actions={<Database aria-hidden className="size-4 text-muted-foreground" />}
    >
      {counts.isError ? (
        <ErrorState error={counts.error} onRetry={() => void counts.refetch()} />
      ) : !counts.data ? (
        <LoadingState rows={1} />
      ) : counts.data.stored ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>{`${counts.data.orders} orders, ${counts.data.trades} trades, ${counts.data.positions} positions stored.`}</span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Open records
          </Button>
          <Link
            to={`/app/records?execution=${executionId}`}
            className="font-medium text-primary hover:underline"
          >
            View in Trading Records &rarr;
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            This run completed before records were stored automatically.
          </span>
          <Button
            size="sm"
            disabled={store.isPending}
            onClick={() =>
              store.mutate(undefined, {
                onSuccess: (c) =>
                  toast.success(
                    `Stored ${c.orders} orders, ${c.trades} trades, ${c.positions} positions.`,
                  ),
                onError: (error) => toast.error((error as Error).message),
              })
            }
          >
            {store.isPending && <Spinner />}
            Store records
          </Button>
        </div>
      )}
      <ExecutionRecordsDrawer
        executionId={executionId}
        open={open}
        onOpenChange={setOpen}
        onRecord={(ref) => {
          setOpen(false);
          setRecord(ref);
        }}
      />
      <RecordDrawer
        record={record}
        onOpen={setRecord}
        onClose={() => setRecord(null)}
        advanced={false}
        names={names}
      />
    </Section>
  );
}
