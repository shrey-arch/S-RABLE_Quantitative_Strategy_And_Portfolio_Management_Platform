import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { badgeText, bellLabel } from './notification-model';
import { useUnreadCount } from './queries';

/**
 * Header bell: the unread count from GET /notifications/unread-count (refreshed
 * every 30 s and after any change), and a link to the notifications page.
 * If the count can't be loaded the bell shows no number.
 */
export function NotificationBell() {
  const { state } = useAuth();
  const count = useUnreadCount(state.status === 'authenticated');
  const unread = count.data;
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link to="/app/notifications" aria-label={bellLabel(unread)}>
        <Bell aria-hidden className="size-4" />
        {unread ? (
          <span
            aria-hidden
            data-testid="unread-badge"
            className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white"
          >
            {badgeText(unread)}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
