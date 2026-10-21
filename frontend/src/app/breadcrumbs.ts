import { matchPath } from 'react-router';
import { NAV_GROUPS, isActive, type NavItem } from './nav';
import { APP_ROUTES, UNAVAILABLE_ROUTES } from './routes';

export interface Crumb {
  label: string;
  /** Link target; absent for group names and the current page. */
  to?: string;
}

export const NOT_FOUND_TITLE = 'Page not found';

const findRoute = (pathname: string) => APP_ROUTES.find((r) => matchPath(r.path, pathname));
const findUnavailable = (pathname: string) =>
  UNAVAILABLE_ROUTES.find((r) => matchPath(r.path, pathname));

/** Title of the /app page at `pathname` (or "Page not found"). */
export function pageTitle(pathname: string): string {
  return findRoute(pathname)?.title ?? findUnavailable(pathname)?.title ?? NOT_FOUND_TITLE;
}

/**
 * Breadcrumbs for an /app page: sidebar group, then section, then the page.
 *   /app/strategies/123  ->  Research > Strategies > Strategy
 *   /app/dashboard       ->  Workspace > Dashboard
 * Not-available and unknown pages show just their title.
 */
export function getCrumbs(pathname: string): Crumb[] {
  const route = findRoute(pathname);
  if (!route) return [{ label: pageTitle(pathname) }];

  for (const group of NAV_GROUPS) {
    const item = group.items.find((i): i is NavItem => !i.planned && isActive(i, pathname));
    if (!item) continue;

    // The section's own page: Group > Section.
    if (route.path === item.to) return [{ label: group.label }, { label: item.label }];

    // A page inside the section. Link back to the section only if it is a list page.
    const crumbs: Crumb[] = [{ label: group.label }];
    if (!item.to.endsWith('/new')) crumbs.push({ label: item.label, to: item.to });
    crumbs.push({ label: route.title });
    return crumbs;
  }
  return [{ label: route.title }];
}
