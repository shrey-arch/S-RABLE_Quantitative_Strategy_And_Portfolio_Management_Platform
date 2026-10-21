import { NavLink, useLocation } from 'react-router';
import { AvailabilityTag } from '@/components/ui/availability-tag';
import { NAV_GROUPS, isActive } from '@/app/nav';
import { cn } from '@/lib/utils';

/** Grouped app navigation. The current section is highlighted and marked aria-current. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Main" className="space-y-5 px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <h2 className="px-2 pb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.label}
          </h2>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              if (item.planned) {
                return (
                  <li
                    key={item.label}
                    aria-disabled="true"
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground/70"
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <AvailabilityTag value="planned" className="px-1.5 py-0 text-[10px]" />
                  </li>
                );
              }
              const active = isActive(item, pathname);
              return (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
