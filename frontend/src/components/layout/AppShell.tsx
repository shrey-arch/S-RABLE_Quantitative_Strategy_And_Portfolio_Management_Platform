import { FlaskConical } from 'lucide-react';
import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { pageTitle } from '@/app/breadcrumbs';
import { AppHeader } from './AppHeader';
import { SidebarNav } from './Sidebar';

/**
 * Frame for every /app page: sidebar on the left (large screens; on smaller screens it
 * opens from the header's menu button), header and page content on the right.
 */
export function AppShell() {
  const { pathname } = useLocation();

  // Browser tab title follows the page.
  useEffect(() => {
    document.title = `${pageTitle(pathname)} \u00b7 S-RABLE`;
  }, [pathname]);

  return (
    <div className="app-ground flex min-h-dvh bg-background text-foreground">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-card shadow-card lg:flex">
        <div className="flex h-14 items-center border-b px-5">
          <Link to="/app/dashboard" className="text-lg font-semibold tracking-tight">
            S-RABLE
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="border-t px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FlaskConical aria-hidden className="size-3.5" />
            Historical simulation only
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
