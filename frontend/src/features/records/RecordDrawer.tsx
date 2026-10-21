import { AlertCircle, ArrowRight, Trash2, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { SimulationLabel } from '@/components/ui/simulation-label';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { MoneyText, NumberText } from '@/components/ui/value-text';
import { formatDateTime, humanize, MISSING } from '@/lib/format';
import {
  FORMULAS,
  MAINTENANCE_LABEL,
  ORDER_ACTIONS,
  type Order,
  type Position,
  type RecordRef,
  type Trade,
} from './records-model';
import type { Names } from './record-columns';
import {
  isNotAvailable,
  useDeleteRecord,
  useOrder,
  useOrderAction,
  useOrders,
  usePosition,
  usePositions,
  useTrade,
  useTrades,
} from './queries';

interface Props {
  record: RecordRef | null;
  onOpen: (ref: RecordRef) => void;
  onClose: () => void;
  advanced: boolean;
  names: Names;
}

const when = (value: string | null | undefined) => (value ? formatDateTime(value) : MISSING);

function Field(props: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words tabular-nums">{props.children}</dd>
    </div>
  );
}

/** One link of the chain: a titled box, optionally opening that record. */
function Step(props: {
  title: string;
  label: string;
  current?: boolean;
  onOpen?: () => void;
  children?: ReactNode;
}) {
  return (
    <li className={`rounded-lg border p-3 ${props.current ? 'border-primary bg-primary/5' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {props.title}
        </p>
        {props.onOpen && (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onOpen}
            aria-label={`Open ${props.label}`}
          >
            Open <ArrowRight />
          </Button>
        )}
      </div>
      <p className="font-medium">{props.label}</p>
      {props.children}
    </li>
  );
}

function ExecutionStep(props: { executionId: string; names: Names }) {
  return (
    <Step title="Execution" label={props.names.execution(props.executionId)}>
      <Link
        to={`/app/executions/${props.executionId}/results`}
        className="text-sm text-primary hover:underline"
      >
        Backtest results &rarr;
      </Link>
    </Step>
  );
}

const orderLabel = (o: Order) =>
  `${o.order_side} ${o.quantity} @ ${o.average_fill_price ?? o.price} \u00b7 ${when(o.order_timestamp)}`;
const tradeLabel = (t: Trade) =>
  `${t.order_side ?? ''} ${t.executed_quantity} @ ${t.executed_price} \u00b7 ${when(t.trade_timestamp)}`.trim();
const positionLabel = (p: Position, names: Names) =>
  `${names.instrument(p.instrument_id)} \u00b7 ${humanize(p.direction)} \u00b7 ${humanize(p.position_status)}`;

function OrderFields({ order, names }: { order: Order; names: Names }) {
  return (
    <dl>
      <Field label="Instrument">{names.instrument(order.instrument_id)}</Field>
      <Field label="Type">{humanize(order.order_type)}</Field>
      <Field label="Side">{order.order_side}</Field>
      <Field label="Status">{humanize(order.status)}</Field>
      <Field label="Quantity">
        <NumberText value={order.quantity} decimals={0} />
      </Field>
      <Field label="Filled">
        <NumberText value={order.filled_quantity} decimals={0} />
      </Field>
      <Field label="Price">
        <NumberText value={order.price} />
      </Field>
      <Field label="Average fill price">
        <NumberText value={order.average_fill_price} />
      </Field>
      <Field label="Time">{when(order.order_timestamp)}</Field>
      <p className="mt-1 text-xs text-muted-foreground">{FORMULAS.orderPrice}</p>
    </dl>
  );
}

function TradeFields({ trade }: { trade: Trade }) {
  return (
    <dl>
      <Field label="Executed quantity">
        <NumberText value={trade.executed_quantity} decimals={0} />
      </Field>
      <Field label="Executed price">
        <NumberText value={trade.executed_price} />
      </Field>
      <Field label="Brokerage">
        <MoneyText value={trade.brokerage} />
      </Field>
      <Field label="Total charges">
        <MoneyText value={trade.total_charges} />
      </Field>
      <Field label="Time">{when(trade.trade_timestamp)}</Field>
      <p className="mt-1 text-xs text-muted-foreground">{FORMULAS.charges}</p>
    </dl>
  );
}

function PositionFields({ position }: { position: Position }) {
  return (
    <dl>
      <Field label="Direction">{humanize(position.direction)}</Field>
      <Field label="Quantity">
        <NumberText value={position.quantity} decimals={0} />
      </Field>
      <Field label="Average price">
        <NumberText value={position.average_price} />
      </Field>
      <Field label="Current price">
        <NumberText value={position.current_price} />
      </Field>
      <Field label="Market value">
        <MoneyText value={position.market_value} />
      </Field>
      <Field label="Realised P&L">
        <MoneyText value={position.realized_pnl} colored />
      </Field>
      <Field label="Unrealised P&L">
        <MoneyText value={position.unrealized_pnl} colored />
      </Field>
      <Field label="Status">{humanize(position.position_status)}</Field>
      <Field label="Last updated">{when(position.last_updated_at)}</Field>
      <Field label="Closed">{when(position.closed_at)}</Field>
      <ul
        className="mt-2 space-y-1 text-xs text-muted-foreground"
        aria-label="How these are computed"
      >
        <li>{FORMULAS.averagePrice}</li>
        <li>{FORMULAS.realized}</li>
        <li>{FORMULAS.unrealized}</li>
      </ul>
    </dl>
  );
}

/** Order status changes and delete, behind Advanced. The backend says why a change is refused. */
function Maintenance(props: { record: RecordRef; order?: Order; onDeleted: () => void }) {
  const action = useOrderAction();
  const remove = useDeleteRecord();
  const [message, setMessage] = useState<string | null>(null);
  const kind = props.record.kind;
  const run = async (work: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await work();
      toast.success(done);
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    }
  };
  return (
    <section
      aria-label="Record maintenance"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-warning">
        <Wrench aria-hidden className="size-4" />
        {MAINTENANCE_LABEL}
      </p>
      {message && (
        <p
          role="alert"
          className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {props.order &&
          ORDER_ACTIONS.map((a) => (
            <ConfirmDialog
              key={a.action}
              trigger={
                <Button size="sm" variant="outline">
                  {a.label}
                </Button>
              }
              title={`${a.label}?`}
              description={`Changes the stored order from ${humanize(props.order!.status)} to ${humanize(a.to)} if its lifecycle allows it. ${MAINTENANCE_LABEL}.`}
              confirmLabel={a.label}
              destructive={false}
              onConfirm={() =>
                run(
                  () => action.mutateAsync({ id: props.record.id, action: a.action }),
                  `Order marked ${humanize(a.to).toLowerCase()}.`,
                )
              }
            />
          ))}
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="destructive">
              <Trash2 /> Delete {kind}
            </Button>
          }
          title={`Delete this ${kind} record?`}
          description={`${
            kind === 'order'
              ? 'The order and its trades are deleted; the position is not changed.'
              : kind === 'trade'
                ? 'The trade is deleted; its order and the position are not changed.'
                : 'The position is deleted; orders and trades are not changed.'
          } ${MAINTENANCE_LABEL}. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={async () => {
            if (
              await run(() => remove.mutateAsync(props.record), `The ${kind} record was deleted.`)
            )
              props.onDeleted();
          }}
        />
      </div>
    </section>
  );
}

function OrderChain({ id, props }: { id: string; props: Props }) {
  const order = useOrder(id);
  const trades = useTrades({ order_id: id }, Boolean(order.data));
  const positions = usePositions(
    order.data
      ? { execution_id: order.data.execution_id, instrument_id: order.data.instrument_id }
      : {},
    Boolean(order.data),
  );
  if (order.isError) return <Problem error={order.error} />;
  if (!order.data) return <LoadingState rows={4} />;
  const o = order.data;
  return (
    <>
      <ol className="space-y-2" aria-label="Relationship chain">
        <ExecutionStep executionId={o.execution_id} names={props.names} />
        <Step title="Order" label={orderLabel(o)} current>
          <OrderFields order={o} names={props.names} />
        </Step>
        <Step title={`Trades (${trades.data?.length ?? '...'})`} label="Fills of this order">
          <ul className="mt-1 space-y-1">
            {(trades.data ?? []).map((t) => (
              <li key={t.id}>
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => props.onOpen({ kind: 'trade', id: t.id })}
                >
                  {tradeLabel(t)}
                </Button>
              </li>
            ))}
            {trades.data?.length === 0 && (
              <li className="text-sm text-muted-foreground">No trades.</li>
            )}
          </ul>
        </Step>
        {(positions.data ?? []).map((p) => (
          <Step
            key={p.id}
            title="Position (execution and instrument)"
            label={positionLabel(p, props.names)}
            onOpen={() => props.onOpen({ kind: 'position', id: p.id })}
          />
        ))}
      </ol>
      {props.advanced && (
        <Maintenance record={{ kind: 'order', id }} order={o} onDeleted={props.onClose} />
      )}
    </>
  );
}

function TradeChain({ id, props }: { id: string; props: Props }) {
  const trade = useTrade(id);
  const order = useOrder(trade.data?.order_id ?? null);
  const positions = usePositions(
    trade.data?.execution_id && trade.data.instrument_id
      ? { execution_id: trade.data.execution_id, instrument_id: trade.data.instrument_id }
      : {},
    Boolean(trade.data?.execution_id),
  );
  if (trade.isError) return <Problem error={trade.error} />;
  if (!trade.data) return <LoadingState rows={4} />;
  const t = trade.data;
  return (
    <>
      <ol className="space-y-2" aria-label="Relationship chain">
        {t.execution_id && <ExecutionStep executionId={t.execution_id} names={props.names} />}
        <Step
          title="Parent order"
          label={order.data ? orderLabel(order.data) : 'Order'}
          onOpen={() => props.onOpen({ kind: 'order', id: t.order_id })}
        />
        <Step title="Trade" label={tradeLabel(t)} current>
          <TradeFields trade={t} />
        </Step>
        {(positions.data ?? []).map((p) => (
          <Step
            key={p.id}
            title="Position (execution and instrument)"
            label={positionLabel(p, props.names)}
            onOpen={() => props.onOpen({ kind: 'position', id: p.id })}
          />
        ))}
      </ol>
      {props.advanced && <Maintenance record={{ kind: 'trade', id }} onDeleted={props.onClose} />}
    </>
  );
}

function PositionChain({ id, props }: { id: string; props: Props }) {
  const position = usePosition(id);
  const orders = useOrders(
    position.data
      ? { execution_id: position.data.execution_id, instrument_id: position.data.instrument_id }
      : {},
    Boolean(position.data),
  );
  if (position.isError) return <Problem error={position.error} />;
  if (!position.data) return <LoadingState rows={4} />;
  const p = position.data;
  return (
    <>
      <ol className="space-y-2" aria-label="Relationship chain">
        <ExecutionStep executionId={p.execution_id} names={props.names} />
        <Step title="Instrument" label={props.names.instrument(p.instrument_id)} />
        <Step title="Position" label={positionLabel(p, props.names)} current>
          <PositionFields position={p} />
        </Step>
        <Step
          title={`Orders (${orders.data?.length ?? '...'})`}
          label="Orders of this execution on this instrument"
        >
          <ul className="mt-1 space-y-1">
            {(orders.data ?? []).map((o) => (
              <li key={o.id}>
                <Button
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => props.onOpen({ kind: 'order', id: o.id })}
                >
                  {orderLabel(o)}
                </Button>
              </li>
            ))}
          </ul>
        </Step>
      </ol>
      {props.advanced && (
        <Maintenance record={{ kind: 'position', id }} onDeleted={props.onClose} />
      )}
    </>
  );
}

function Problem({ error }: { error: unknown }) {
  return isNotAvailable(error) ? (
    <p role="alert" className="text-sm text-muted-foreground">
      This record does not exist, or it belongs to another account.
    </p>
  ) : (
    <ErrorState error={error} />
  );
}

const TITLES = { order: 'Order', trade: 'Trade', position: 'Position' } as const;

/** Detail drawer: the record and how it links to its execution, order, trades and position. */
export function RecordDrawer(props: Props) {
  const ref = props.record;
  return (
    <Sheet open={Boolean(ref)} onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-5 sm:max-w-xl">
        <SheetTitle className="text-lg">{ref ? TITLES[ref.kind] : 'Record'}</SheetTitle>
        <SheetDescription className="mb-3">
          A simulated record stored from a backtest. No order was sent to a broker.
        </SheetDescription>
        <SimulationLabel className="mb-4 w-fit" />
        {ref?.kind === 'order' && <OrderChain key={ref.id} id={ref.id} props={props} />}
        {ref?.kind === 'trade' && <TradeChain key={ref.id} id={ref.id} props={props} />}
        {ref?.kind === 'position' && <PositionChain key={ref.id} id={ref.id} props={props} />}
      </SheetContent>
    </Sheet>
  );
}
