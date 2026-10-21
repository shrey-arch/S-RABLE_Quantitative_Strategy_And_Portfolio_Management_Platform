import type { components } from '@/api/schema';

type Schemas = components['schemas'];
export type Notification = Schemas['NotificationResponse'];
export type NotificationType = Schemas['NotificationType'];
export type NotificationPriority = Schemas['NotificationPriority'];

export const NOTIFICATION_TYPES = [
  'INFO',
  'WARNING',
  'ERROR',
  'TRADE',
] as const satisfies readonly NotificationType[];

export const PRIORITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const satisfies readonly NotificationPriority[];

/** The header bell asks for the unread count this often. */
export const UNREAD_POLL_MS = 30_000;

export const NOTIFICATION_TABS = ['all', 'unread'] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];
export const TAB_LABELS: Record<NotificationTab, string> = { all: 'All', unread: 'Unread' };

export const isNotificationTab = (value: string | null): value is NotificationTab =>
  (NOTIFICATION_TABS as readonly string[]).includes(value ?? '');

export interface NotificationFilters {
  is_read?: boolean;
  notification_type?: NotificationType;
  priority?: NotificationPriority;
}

const isType = (v: string | null): v is NotificationType =>
  (NOTIFICATION_TYPES as readonly string[]).includes(v ?? '');
const isPriority = (v: string | null): v is NotificationPriority =>
  (PRIORITIES as readonly string[]).includes(v ?? '');

/** The API filters for the address: ?tab=unread&type=ERROR&priority=HIGH. */
export function filtersFrom(params: URLSearchParams): NotificationFilters {
  const filters: NotificationFilters = {};
  if (params.get('tab') === 'unread') filters.is_read = false;
  const type = params.get('type');
  if (isType(type)) filters.notification_type = type;
  const priority = params.get('priority');
  if (isPriority(priority)) filters.priority = priority;
  return filters;
}

/**
 * Where a notification leads: a paper deployment's news to that deployment, a live
 * session's to that session (its id is the run's id); a
 * completed backtest to its results, a validation run to its report, a portfolio
 * backtest to its page, any other run
 * to its status page. Uses the run as the backend reports it now; no run, no link.
 */
export function notificationLink(n: Notification): { to: string; label: string } | null {
  const data = (n.notification_data ?? {}) as Record<string, unknown>;
  if (data.event === 'PAPER_DEPLOYMENT' && typeof data.deployment_id === 'string')
    return { to: `/app/live/deployments/${data.deployment_id}`, label: 'Open paper deployment' };
  if (data.event === 'LIVE_SESSION' && typeof data.session_id === 'string')
    return { to: `/app/live/sessions/${data.session_id}`, label: 'Open live session' };
  const id = n.execution_id;
  if (id && n.execution_type === 'LIVE')
    return { to: `/app/live/sessions/${id}`, label: 'Open live session' };
  if (!id) return null;
  if (n.execution_type === 'PORTFOLIO_BACKTEST')
    return { to: `/app/portfolio-backtests/${id}`, label: 'Open portfolio backtest' };
  if (n.execution_type === 'VALIDATION')
    return { to: `/app/validation/${id}`, label: 'Open validation report' };
  if (n.execution_type === 'BACKTEST' && n.execution_status === 'COMPLETED')
    return { to: `/app/executions/${id}/results`, label: 'Open results' };
  return { to: `/app/backtests/${id}`, label: 'Open run' };
}

/** The bell's badge text. */
export const badgeText = (count: number) => (count > 99 ? '99+' : String(count));

export const bellLabel = (count: number | undefined) =>
  count === undefined
    ? 'Notifications'
    : count === 0
      ? 'Notifications, none unread'
      : `Notifications, ${count} unread`;
