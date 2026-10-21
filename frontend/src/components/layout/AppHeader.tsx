import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';
import { getCrumbs } from '@/app/breadcrumbs';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

/**
 * Top bar of every /app page: menu button (small screens), breadcrumbs ending in the
 * page title, theme switch, notification bell and user menu.
 */
export function AppHeader() {
  const { pathname } = useLocation();
  const crumbs = getCrumbs(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur sm:px-6">
      <MobileNav />
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 && (
                  <li aria-hidden className="hidden text-muted-foreground sm:block">
                    <ChevronRight className="size-3.5" />
                  </li>
                )}
                {/* Phones show only the current page; wider screens show the full trail. */}
                <li className={last ? 'min-w-0 truncate' : 'hidden shrink-0 sm:block'}>
                  {last ? (
                    <span aria-current="page" className="font-semibold text-foreground">
                      {crumb.label}
                    </span>
                  ) : crumb.to ? (
                    <Link to={crumb.to} className="text-muted-foreground hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">{crumb.label}</span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
