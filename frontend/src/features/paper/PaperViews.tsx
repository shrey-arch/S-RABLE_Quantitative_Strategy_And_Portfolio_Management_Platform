import type { ColumnDef } from '@tanstack/react-table';
import { NotebookPen, Pencil, Plus, X } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable } from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { MoneyText } from '@/components/ui/value-text';
import { InstrumentPicker } from '@/features/instruments/InstrumentPicker';
import { formatDate, formatDateTime, formatINR, formatPercent, MISSING } from '@/lib/format';
import type { CsvValue } from '@/lib/csv';
import { cn } from '@/lib/utils';
import {
  CHARGE_KEYS,
  CHARGE_LABELS,
  isLive,
  ORDER_TYPE_LABELS,
  parseTags,
  quoteAge,
  STATUS_LABELS,
  tradable,
  type OrderType,
  type PaperAccount,
  type PaperFill,
  type PaperHolding,
  type PaperOrder,
  type QuoteRow,
  type Side,
} from './paper-model';
import {
  useCancelOrder,
  useJournal,
  useModifyOrder,
  usePaperCharges,
  usePaperQuotes,
  useResetAccount,
  useSetWatchlist,
  useUpdateSettings,
} from './queries';

const failed = (error: unknown) => toast.error((error as Error).message);

export function Tile(props: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card shadow-card p-4">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{props.children}</p>
      {props.hint && <p className="mt-0.5 text-xs text-muted-foreground">{props.hint}</p>}
    </div>
  );
}

/** Account totals exactly as GET /paper/account returns them. */
export function AccountSummary({ account }: { account: PaperAccount }) {
  const unpriced = account.all_priced ? undefined : 'A holding has no price right now.';
  return (
    <section aria-label="Account summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Equity" hint={`Started with ${formatINR(account.initial_cash)}`}>
        <MoneyText value={account.equity} missingReason={unpriced} />
      </Tile>
      <Tile
        label="Available cash"
        hint={
          account.blocked_cash > 0
            ? `${formatINR(account.blocked_cash)} held for open buys`
            : undefined
        }
      >
        <MoneyText value={account.available_cash} />
      </Tile>
      <Tile label="Holdings value" hint={`Invested ${formatINR(account.invested)}`}>
        <MoneyText value={account.holdings_value} missingReason={unpriced} />
      </Tile>
      <Tile label="Total P&L" hint="Equity minus starting cash (after charges)">
        <MoneyText value={account.total_pnl} colored missingReason={unpriced} />
      </Tile>
      <Tile label="Unrealised P&L">
        <MoneyText value={account.unrealised_pnl} colored missingReason={unpriced} />
      </Tile>
      <Tile label="Realised P&L" hint="Before charges">
        <MoneyText value={account.realised_pnl} colored />
      </Tile>
      <Tile label="Charges paid">
        <MoneyText value={account.total_charges} />
      </Tile>
      <Tile label="Cash">
        <MoneyText value={account.cash} />
      </Tile>
    </section>
  );
}

/** Market open/closed as the backend reports it, and where prices come from. */
export function MarketBanner({ account }: { account: PaperAccount }) {
  const m = account.market;
  return (
    <div
      role="status"
      aria-label="Market status"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm"
    >
      <span className="flex items-center gap-2 font-medium">
        <span
          aria-hidden
          className={cn('size-2 rounded-full', m.is_open ? 'bg-success' : 'bg-muted-foreground')}
        />
        {m.is_open ? 'NSE market open' : 'NSE market closed'}
      </span>
      <span className="text-muted-foreground">
        {m.is_open
          ? `Session ${m.session}; day orders expire at the close.`
          : `Next session ${m.next_open ? formatDateTime(m.next_open) : MISSING}. Orders placed now are after-market orders.`}
      </span>
      <span className="text-muted-foreground">{account.price_source.note}</span>
    </div>
  );
}

function QuoteCell({ row }: { row: QuoteRow }) {
  if (!row.quote) return <span className="text-xs text-muted-foreground">{row.problem}</span>;
  const q = row.quote;
  return (
    <div className="text-right">
      <MoneyText value={q.price} className="font-medium" />
      <span
        className={cn(
          'ml-2 text-xs tabular-nums',
          (q.change ?? 0) > 0 ? 'text-success' : (q.change ?? 0) < 0 ? 'text-destructive' : '',
        )}
      >
        {q.change_percent === null ? MISSING : formatPercent(q.change_percent, 'percent')}
      </span>
      <span className="block text-xs text-muted-foreground">
        {`${formatDateTime(q.time)} \u00b7 ${quoteAge(q)}`}
      </span>
    </div>
  );
}

/** Saved instruments with their delayed quotes, and Buy / Sell buttons. */
export function Watchlist(props: {
  account: PaperAccount;
  onTrade: (instrumentId: string, side: Side) => void;
}) {
  const ids = props.account.watchlist;
  const quotes = usePaperQuotes(ids);
  const save = useSetWatchlist();
  const [adding, setAdding] = useState('');
  const add = (id: string) => {
    setAdding('');
    if (!id || ids.includes(id)) return;
    save.mutate([...ids, id], { onError: failed });
  };
  return (
    <section aria-labelledby="watchlist" className="space-y-3 rounded-xl border bg-card shadow-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="watchlist" className="font-semibold">
          Watchlist
        </h2>
        <div className="flex w-full items-center gap-2 sm:w-72">
          <Plus aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <label htmlFor="watchlist-add" className="sr-only">
            Add to watchlist
          </label>
          <InstrumentPicker
            id="watchlist-add"
            value={adding}
            filter={(i) => tradable(i) && !ids.includes(i.id)}
            onChange={add}
            className="w-full"
          />
        </div>
      </div>
      {ids.length === 0 ? (
        <EmptyState
          title="Your watchlist is empty"
          description="Add NSE equities or ETFs to see their prices and trade them."
        />
      ) : quotes.isError ? (
        <ErrorState error={quotes.error} onRetry={() => void quotes.refetch()} />
      ) : !quotes.data ? (
        <LoadingState rows={3} />
      ) : (
        <ul aria-label="Watchlist instruments" className="divide-y">
          {quotes.data.map((row) => (
            <li
              key={row.instrument_id}
              aria-label={row.symbol}
              className="flex flex-wrap items-center gap-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{row.symbol}</p>
                <p className="truncate text-xs text-muted-foreground">{row.name}</p>
              </div>
              <QuoteCell row={row} />
              <div className="flex gap-1">
                <Button size="sm" onClick={() => props.onTrade(row.instrument_id, 'BUY')}>
                  Buy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => props.onTrade(row.instrument_id, 'SELL')}
                >
                  Sell
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${row.symbol} from the watchlist`}
                  onClick={() =>
                    save.mutate(
                      ids.filter((i) => i !== row.instrument_id),
                      { onError: failed },
                    )
                  }
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ModifyDialog(props: { order: PaperOrder; onClose: () => void }) {
  const { order } = props;
  const [qty, setQty] = useState(String(order.quantity));
  const [price, setPrice] = useState(order.price === null ? '' : String(order.price));
  const [trigger, setTrigger] = useState(
    order.trigger_price === null ? '' : String(order.trigger_price),
  );
  const [error, setError] = useState<string | null>(null);
  const modify = useModifyOrder();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const quantity = Number(qty);
    if (!/^\d+$/.test(qty.trim()) || quantity < 1) {
      setError('Quantity must be a whole number of at least 1.');
      return;
    }
    const body: { id: string; quantity?: number; price?: number; trigger_price?: number } = {
      id: order.id,
      quantity,
    };
    if (order.price !== null) body.price = Number(price);
    if (order.trigger_price !== null) body.trigger_price = Number(trigger);
    if ([body.price, body.trigger_price].some((v) => v !== undefined && !(v > 0))) {
      setError('Prices must be above 0.');
      return;
    }
    setError(null);
    try {
      await modify.mutateAsync(body);
      toast.success('Order changed.');
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !modify.isPending && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify order</DialogTitle>
          <DialogDescription>
            {`${order.side} ${order.symbol} \u00b7 ${ORDER_TYPE_LABELS[order.order_type as OrderType]}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              {error}
            </p>
          )}
          <FormField label="Quantity">
            {(f) => (
              <Input
                {...f}
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            )}
          </FormField>
          {order.price !== null && (
            <FormField label="Price (Rs)">
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              )}
            </FormField>
          )}
          {order.trigger_price !== null && (
            <FormField label="Trigger price (Rs)">
              {(f) => (
                <Input
                  {...f}
                  inputMode="decimal"
                  value={trigger}
                  onChange={(e) => setTrigger(e.target.value)}
                />
              )}
            </FormField>
          )}
          <DialogFooter>
            <Button type="submit" disabled={modify.isPending}>
              {modify.isPending && <Spinner />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Your note and tags on an order (PATCH /paper/orders/{id}/journal). */
function JournalDialog(props: { order: PaperOrder; onClose: () => void }) {
  const { order } = props;
  const [note, setNote] = useState(order.note ?? '');
  const [tags, setTags] = useState(order.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const journal = useJournal();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (note.length > 1000) {
      setError('The note can be at most 1,000 characters.');
      return;
    }
    setError(null);
    try {
      await journal.mutateAsync({
        id: order.id,
        body: { note: note.trim() === '' ? null : note, tags: parseTags(tags) },
      });
      toast.success('Journal saved.');
      props.onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !journal.isPending && props.onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trade journal</DialogTitle>
          <DialogDescription>
            {`${order.side} ${order.quantity} ${order.symbol} \u00b7 ${formatDateTime(order.placed_at)}`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              {error}
            </p>
          )}
          <FormField
            label="Note"
            hint="Why you placed it, what you expected. Up to 1,000 characters."
          >
            {(f) => (
              <Textarea
                {...f}
                rows={4}
                maxLength={1000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Tags"
            hint="Separated by commas, at most 10 (for example: breakout, earnings)."
          >
            {(f) => <Input {...f} value={tags} onChange={(e) => setTags(e.target.value)} />}
          </FormField>
          <DialogFooter>
            <Button type="submit" disabled={journal.isPending}>
              {journal.isPending && <Spinner />}
              Save journal
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrderActions(props: { order: PaperOrder; onModify: () => void; onJournal: () => void }) {
  const { order } = props;
  const cancel = useCancelOrder();
  const name = `${order.side} ${order.quantity} ${order.symbol}`;
  return (
    <div className="flex justify-end gap-1">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Journal for ${name}`}
        onClick={props.onJournal}
      >
        <NotebookPen aria-hidden className="size-4" />
      </Button>
      {isLive(order.status) && (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Modify ${name}`}
            onClick={props.onModify}
          >
            <Pencil aria-hidden className="size-4" />
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={`Cancel ${name}`}>
                <X aria-hidden className="size-4" />
              </Button>
            }
            title="Cancel this order?"
            description={name}
            confirmLabel="Cancel order"
            onConfirm={() => cancel.mutateAsync(order.id).catch(failed)}
          />
        </>
      )}
    </div>
  );
}

/** Who placed the order, and the user's journal (note and tags). */
function JournalCell({ order }: { order: PaperOrder }) {
  return (
    <div className="max-w-64 space-y-1">
      {order.source === 'STRATEGY' ? (
        order.deployment_id ? (
          <Link
            to={`/app/live/deployments/${order.deployment_id}`}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Strategy order
          </Link>
        ) : (
          <span className="text-xs font-medium">Strategy order</span>
        )
      ) : (
        <span className="text-xs text-muted-foreground">Manual</span>
      )}
      {order.note && <p className="line-clamp-2 text-xs">{order.note}</p>}
      {order.tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-1">
          {order.tags.map((t) => (
            <li key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Exports each column's accessor value (the API's own number) to CSV. */
function withCsv<T>(cols: ColumnDef<T>[]): ColumnDef<T>[] {
  return cols.map((c) =>
    'accessorFn' in c && c.accessorFn
      ? { ...c, meta: { ...c.meta, csv: (row: T) => c.accessorFn!(row, 0) as CsvValue } }
      : c,
  );
}

const priceOrDash = (v: number | null) => (v === null ? MISSING : formatINR(v));

/** The order book: every paper order, newest first, as the API returns it. */
export function OrdersTable(props: { orders: PaperOrder[]; caption: string }) {
  const [editing, setEditing] = useState<PaperOrder | null>(null);
  const [journal, setJournal] = useState<PaperOrder | null>(null);
  const columns = useMemo<ColumnDef<PaperOrder>[]>(
    () => [
      {
        id: 'placed',
        header: 'Placed',
        accessorFn: (o) => o.placed_at,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{formatDateTime(row.original.placed_at)}</span>
        ),
      },
      { id: 'symbol', header: 'Instrument', accessorFn: (o) => o.symbol },
      {
        id: 'side',
        header: 'Side',
        accessorFn: (o) => o.side,
        cell: ({ row }) => (
          <span className={row.original.side === 'BUY' ? 'text-success' : 'text-destructive'}>
            {row.original.side}
          </span>
        ),
      },
      {
        id: 'type',
        header: 'Type',
        accessorFn: (o) => ORDER_TYPE_LABELS[o.order_type as OrderType] ?? o.order_type,
      },
      { id: 'qty', header: 'Qty', accessorFn: (o) => o.quantity },
      { id: 'price', header: 'Price', accessorFn: (o) => priceOrDash(o.price) },
      { id: 'trigger', header: 'Trigger', accessorFn: (o) => priceOrDash(o.trigger_price) },
      { id: 'avg', header: 'Fill price', accessorFn: (o) => priceOrDash(o.average_price) },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (o) => STATUS_LABELS[o.status] ?? o.status,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <StatusBadge kind="paperOrder" value={row.original.status} />
            {row.original.after_market && isLive(row.original.status) && (
              <p className="text-xs text-muted-foreground">{`After-market, for ${formatDate(row.original.session_date)}`}</p>
            )}
            {row.original.status_message && (
              <p className="max-w-56 text-xs text-muted-foreground">
                {row.original.status_message}
              </p>
            )}
          </div>
        ),
      },
      {
        id: 'journal',
        header: 'Journal',
        accessorFn: (o) => [o.source, o.note ?? '', o.tags.join(' ')].join(' '),
        cell: ({ row }) => <JournalCell order={row.original} />,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <OrderActions
            order={row.original}
            onModify={() => setEditing(row.original)}
            onJournal={() => setJournal(row.original)}
          />
        ),
      },
    ],
    [],
  );
  return (
    <>
      <DataTable
        caption={props.caption}
        columns={columns}
        data={props.orders}
        empty={<EmptyState title="No orders" description="Place an order from the watchlist." />}
      />
      {editing && (
        <ModifyDialog key={editing.id} order={editing} onClose={() => setEditing(null)} />
      )}
      {journal && (
        <JournalDialog key={journal.id} order={journal} onClose={() => setJournal(null)} />
      )}
    </>
  );
}

/** Holdings at their latest (delayed) price. */
export function HoldingsTable(props: {
  holdings: PaperHolding[];
  onSell: (instrumentId: string) => void;
}) {
  if (props.holdings.length === 0)
    return <EmptyState title="No holdings" description="Bought shares appear here." />;
  return (
    <div className="relative overflow-x-auto rounded-xl border">
      <table aria-label="Holdings" className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            {[
              'Instrument',
              'Qty',
              'Avg. price',
              'Last price',
              'Invested',
              'Value',
              'Unrealised P&L',
              '',
            ].map((h, i) => (
              <th
                key={i}
                scope="col"
                className={cn('px-3 py-2 font-medium', i > 0 && 'text-right')}
              >
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {props.holdings.map((h) => (
            <tr key={h.instrument_id}>
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {h.symbol}
              </th>
              <td className="px-3 py-2 text-right tabular-nums">{h.quantity}</td>
              <td className="px-3 py-2 text-right">
                <MoneyText value={h.average_price} />
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyText value={h.last_price} missingReason={h.quote_problem ?? undefined} />
                {h.quote && (
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(h.quote.time)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyText value={h.invested} />
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyText value={h.market_value} missingReason={h.quote_problem ?? undefined} />
              </td>
              <td className="px-3 py-2 text-right">
                <MoneyText
                  value={h.unrealised_pnl}
                  colored
                  missingReason={h.quote_problem ?? undefined}
                />
              </td>
              <td className="px-3 py-2 text-right">
                <Button size="sm" variant="outline" onClick={() => props.onSell(h.instrument_id)}>
                  Sell
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Fills with every charge, as stored by the backend. */
export function FillsTable({ fills }: { fills: PaperFill[] }) {
  const columns = useMemo<ColumnDef<PaperFill>[]>(
    () =>
      withCsv<PaperFill>([
        {
          id: 'time',
          header: 'Filled',
          accessorFn: (f) => f.filled_at,
          cell: ({ row }) => (
            <span className="whitespace-nowrap">{formatDateTime(row.original.filled_at)}</span>
          ),
        },
        { id: 'symbol', header: 'Instrument', accessorFn: (f) => f.symbol },
        { id: 'side', header: 'Side', accessorFn: (f) => f.side },
        { id: 'qty', header: 'Qty', accessorFn: (f) => f.quantity },
        {
          id: 'price',
          header: 'Fill price',
          accessorFn: (f) => f.price,
          cell: ({ row }) => (
            <span>
              <MoneyText value={row.original.price} />
              <span className="block text-xs text-muted-foreground">
                {`quote ${formatINR(row.original.quote_price)} at ${formatDateTime(row.original.quote_time)}`}
              </span>
            </span>
          ),
        },
        {
          id: 'value',
          header: 'Value',
          accessorFn: (f) => f.trade_value,
          cell: ({ row }) => <MoneyText value={row.original.trade_value} />,
        },
        ...CHARGE_KEYS.map(
          (k): ColumnDef<PaperFill> => ({
            id: k,
            header: CHARGE_LABELS[k],
            accessorFn: (f) => f.charges[k] ?? 0,
            cell: ({ row }) => <MoneyText value={row.original.charges[k]} />,
          }),
        ),
        {
          id: 'charges',
          header: 'Total charges',
          accessorFn: (f) => f.total_charges,
          cell: ({ row }) => <MoneyText value={row.original.total_charges} />,
        },
        {
          id: 'net',
          header: 'Cash change',
          accessorFn: (f) => f.net_amount,
          cell: ({ row }) => <MoneyText value={row.original.net_amount} colored />,
        },
        {
          id: 'pnl',
          header: 'Realised P&L',
          accessorFn: (f) => f.realised_pnl,
          cell: ({ row }) => <MoneyText value={row.original.realised_pnl} colored />,
        },
      ]),
    [],
  );
  return (
    <DataTable
      caption="Fills"
      columns={columns}
      data={fills}
      csvFileName="paper-fills.csv"
      empty={
        <EmptyState
          title="No fills yet"
          description="Filled orders appear here with their charges."
        />
      }
    />
  );
}

/** Slippage and brokerage, the charge rates, and Reset. */
export function SettingsPanel({ account }: { account: PaperAccount }) {
  const charges = usePaperCharges();
  const update = useUpdateSettings();
  const reset = useResetAccount();
  const [slippage, setSlippage] = useState(String(account.slippage_bps));
  const [brokerage, setBrokerage] = useState(String(account.brokerage_per_order));
  const [cash, setCash] = useState(String(account.initial_cash));
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const s = Number(slippage);
    const b = Number(brokerage);
    if (!(s >= 0 && s <= 100) || slippage.trim() === '')
      return setError('Slippage must be 0 to 100 bps.');
    if (!(b >= 0 && b <= 1000) || brokerage.trim() === '')
      return setError('Brokerage must be Rs 0 to Rs 1,000.');
    setError(null);
    try {
      await update.mutateAsync({ slippage_bps: s, brokerage_per_order: b });
      toast.success('Settings saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const resetCash = Number(cash);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        onSubmit={save}
        noValidate
        aria-labelledby="paper-settings"
        className="space-y-4 rounded-xl border bg-card shadow-card p-4"
      >
        <h2 id="paper-settings" className="font-semibold">
          Costs
        </h2>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <FormField
          label="Slippage (bps)"
          hint="Added to market buys and taken from market sells. 5 bps = 0.05%."
        >
          {(f) => (
            <Input
              {...f}
              inputMode="decimal"
              value={slippage}
              onChange={(e) => setSlippage(e.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Brokerage per executed order (Rs)"
          hint="Many brokers charge Rs 0 for delivery."
        >
          {(f) => (
            <Input
              {...f}
              inputMode="decimal"
              value={brokerage}
              onChange={(e) => setBrokerage(e.target.value)}
            />
          )}
        </FormField>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending && <Spinner />}
          Save costs
        </Button>
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Start again</h3>
          <FormField label="Starting cash (Rs)">
            {(f) => (
              <Input
                {...f}
                inputMode="decimal"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            )}
          </FormField>
          <ConfirmDialog
            trigger={
              <Button type="button" variant="outline" disabled={!(resetCash > 0)}>
                Reset account
              </Button>
            }
            title="Reset the paper account?"
            description={`Every order, fill and holding is deleted and the account starts again with ${formatINR(resetCash)}.`}
            confirmLabel="Reset"
            onConfirm={() =>
              reset.mutateAsync(resetCash).then(() => toast.success('Paper account reset.'), failed)
            }
          />
        </div>
      </form>
      <section aria-labelledby="charge-rates" className="space-y-3 rounded-xl border bg-card shadow-card p-4">
        <h2 id="charge-rates" className="font-semibold">
          How charges are calculated
        </h2>
        {charges.isError ? (
          <ErrorState error={charges.error} />
        ) : !charges.data ? (
          <LoadingState rows={4} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {`${charges.data.product}, rates as of ${formatDate(charges.data.as_of)}. Each component is rounded to the paisa.`}
            </p>
            <ul className="divide-y text-sm">
              {charges.data.rates.map((r) => (
                <li key={r.key} className="flex flex-wrap justify-between gap-2 py-1.5">
                  <span>{r.label}</span>
                  <span className="text-muted-foreground">{`${r.basis} \u00b7 ${r.applies_to}`}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{charges.data.brokerage}</p>
            <p className="text-xs text-muted-foreground">{`Not included: ${charges.data.not_included}`}</p>
          </>
        )}
      </section>
    </div>
  );
}
