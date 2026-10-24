import { Bell, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime, humanize } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  filtersFrom,
  NOTIFICATION_TABS,
  NOTIFICATION_TYPES,
  notificationLink,
  PRIORITIES,
  TAB_LABELS,
  type Notification,
  type NotificationTab,
} from './notification-model';
import { useDeleteNotification, useNotifications, useSetRead, useUnreadCount } from './queries';

const failed = (error: unknown) => toast.error((error as Error).message);

function NotificationItem({ item }: { item: Notification }) {
  const setRead = useSetRead();
  const remove = useDeleteNotification();
  const link = notificationLink(item);
  const titleId = `notification-${item.id}`;
  const toggle = () => setRead.mutate({ id: item.id, is_read: !item.is_read }, { onError: failed });
  return (
    <li
      aria-labelledby={titleId}
      className={cn(
        'rounded-xl border bg-card shadow-card p-4',
        !item.is_read && 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          aria-hidden
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            item.is_read ? 'bg-transparent' : 'bg-primary',
          )}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-sm font-semibold">
              {item.title}
            </h2>
            {!item.is_read && <span className="text-xs font-medium text-primary">Unread</span>}
            <StatusBadge kind="notificationType" value={item.notification_type} />
            <StatusBadge kind="priority" value={item.priority} />
          </div>
          <p className="text-sm break-words text-muted-foreground">{item.message}</p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={item.created_at}>{formatDateTime(item.created_at)}</time>
            {item.read_at && ` \u00b7 read ${formatDateTime(item.read_at)}`}
          </p>
          {link && (
            <Link
              to={link.to}
              onClick={() => {
                if (!item.is_read) setRead.mutate({ id: item.id, is_read: true });
              }}
              className="inline-block text-sm font-medium text-primary hover:underline"
            >
              {`${link.label} \u2192`}
            </Link>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={setRead.isPending}
            onClick={toggle}
            aria-label={`${item.is_read ? 'Mark unread' : 'Mark read'}: ${item.title}`}
          >
            {item.is_read ? 'Mark unread' : 'Mark read'}
          </Button>
          <ConfirmDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={`Delete: ${item.title}`}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            }
            title="Delete this notification?"
            description={item.title}
            confirmLabel="Delete"
            onConfirm={() => remove.mutateAsync(item.id).catch(failed)}
          />
        </div>
      </div>
    </li>
  );
}

/** /app/notifications - the user's notifications, newest first. */
export default function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const tab: NotificationTab = params.get('tab') === 'unread' ? 'unread' : 'all';
  const filters = filtersFrom(params);
  const list = useNotifications(filters);
  const unread = useUnreadCount();
  const set = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const filtered = Boolean(filters.notification_type || filters.priority);

  const body = list.isError ? (
    <ErrorState error={list.error} onRetry={() => void list.refetch()} />
  ) : !list.data ? (
    <LoadingState rows={4} />
  ) : list.data.length === 0 ? (
    <EmptyState
      title={
        filtered
          ? 'No notifications match these filters'
          : tab === 'unread'
            ? 'No unread notifications'
            : 'No notifications yet'
      }
      description={
        filtered || tab === 'unread'
          ? undefined
          : 'A notification appears here when one of your backtests or validation runs completes, fails or is cancelled.'
      }
    />
  ) : (
    <ul className="space-y-3" aria-label="Notification list">
      {list.data.map((item) => (
        <NotificationItem key={item.id} item={item} />
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 page-title text-3xl">
          <Bell aria-hidden className="size-5 text-muted-foreground" />
          Notifications
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Messages from the backend about your runs. Opening a run marks its notification read.
        </p>
      </div>
      <Tabs value={tab} onValueChange={(t) => set('tab', t === 'unread' ? t : null)}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TabsList aria-label="Show">
            {NOTIFICATION_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {t === 'unread' && unread.data !== undefined
                  ? `${TAB_LABELS[t]} (${unread.data})`
                  : TAB_LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filters">
            <div className="space-y-1">
              <Label htmlFor="filter-type" className="text-xs">
                Type
              </Label>
              <NativeSelect
                id="filter-type"
                value={filters.notification_type ?? ''}
                onChange={(e) => set('type', e.target.value)}
              >
                <NativeSelectOption value="">All types</NativeSelectOption>
                {NOTIFICATION_TYPES.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {humanize(t)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-priority" className="text-xs">
                Priority
              </Label>
              <NativeSelect
                id="filter-priority"
                value={filters.priority ?? ''}
                onChange={(e) => set('priority', e.target.value)}
              >
                <NativeSelectOption value="">All priorities</NativeSelectOption>
                {PRIORITIES.map((p) => (
                  <NativeSelectOption key={p} value={p}>
                    {humanize(p)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>
        {NOTIFICATION_TABS.map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            {t === tab && body}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
