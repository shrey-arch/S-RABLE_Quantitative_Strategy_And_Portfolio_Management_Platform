import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderTicket } from './OrderTicket';
import { emptyTicket, isLive, PAPER_LABEL, type Side, type TicketDraft } from './paper-model';
import {
  AccountSummary,
  FillsTable,
  HoldingsTable,
  MarketBanner,
  OrdersTable,
  SettingsPanel,
  Watchlist,
} from './PaperViews';
import { usePaperAccount, usePaperFills, usePaperHoldings, usePaperOrders } from './queries';

const TABS = ['orders', 'book', 'holdings', 'fills', 'settings'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  orders: 'Open orders',
  book: 'Order book',
  holdings: 'Holdings',
  fills: 'Fills',
  settings: 'Settings',
};
const isTab = (v: string | null): v is Tab => (TABS as readonly string[]).includes(v ?? '');

function Lists(props: { tab: Tab; onSell: (id: string) => void }) {
  const orders = usePaperOrders();
  const holdings = usePaperHoldings();
  const fills = usePaperFills();
  if (props.tab === 'holdings') {
    if (holdings.isError)
      return <ErrorState error={holdings.error} onRetry={() => void holdings.refetch()} />;
    if (!holdings.data) return <LoadingState rows={3} />;
    return <HoldingsTable holdings={holdings.data} onSell={props.onSell} />;
  }
  if (props.tab === 'fills') {
    if (fills.isError)
      return <ErrorState error={fills.error} onRetry={() => void fills.refetch()} />;
    return <FillsTable fills={fills.data ?? []} />;
  }
  if (orders.isError)
    return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;
  if (!orders.data) return <LoadingState rows={3} />;
  const rows = props.tab === 'orders' ? orders.data.filter((o) => isLive(o.status)) : orders.data;
  return <OrdersTable caption={TAB_LABELS[props.tab]} orders={rows} />;
}

/**
 * The "Paper account" tab of Live Trading (Paper): the user's virtual NSE account
 * (Feature 1). Its own views live in the address as ?view=book and so on.
 */
export function PaperAccountPanel() {
  const [params, setParams] = useSearchParams();
  const value = params.get('view');
  const tab: Tab = isTab(value) ? value : 'orders';
  const account = usePaperAccount();
  const [ticket, setTicket] = useState<{ key: number; draft: TicketDraft } | null>(null);
  const trade = (instrumentId: string, side: Side) =>
    setTicket({ key: Date.now(), draft: emptyTicket(instrumentId, side) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          A virtual NSE account for equity delivery trades. Orders are filled by S-RABLE on delayed
          market quotes with Indian charges; nothing is sent to a broker. Deployed strategies trade
          it at each close, and live sessions' intraday fills land here too.
        </p>
        <p className="inline-flex rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
          {PAPER_LABEL}
        </p>
        <Button onClick={() => trade('', 'BUY')}>
          <Plus /> New order
        </Button>
      </div>
      {account.isError ? (
        <ErrorState error={account.error} onRetry={() => void account.refetch()} />
      ) : !account.data ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <MarketBanner account={account.data} />
          <AccountSummary account={account.data} />
          <Watchlist account={account.data} onTrade={trade} />
          <Tabs
            value={tab}
            onValueChange={(t) =>
              setParams(
                (prev) => {
                  const p = new URLSearchParams(prev);
                  if (t === 'orders') p.delete('view');
                  else p.set('view', t);
                  return p;
                },
                { replace: true },
              )
            }
          >
            <TabsList aria-label="Account views" className="h-auto flex-wrap justify-start">
              {TABS.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABELS[t]}
                </TabsTrigger>
              ))}
            </TabsList>
            {TABS.map((t) => (
              <TabsContent key={t} value={t}>
                {t === tab &&
                  (t === 'settings' ? (
                    <SettingsPanel key={account.data.reset_count} account={account.data} />
                  ) : (
                    <Lists tab={t} onSell={(id) => trade(id, 'SELL')} />
                  ))}
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}
      {ticket && (
        <OrderTicket key={ticket.key} draft={ticket.draft} onClose={() => setTicket(null)} />
      )}
    </div>
  );
}
