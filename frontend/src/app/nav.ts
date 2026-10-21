import {
  Activity,
  Bell,
  Blocks,
  ChartCandlestick,
  ChartPie,
  ChartSpline,
  CirclePlay,
  Compass,
  History,
  Landmark,
  Layers,
  Radio,
  ReceiptText,
  LayoutDashboard,
  ShieldCheck,
  Trophy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * Sidebar navigation, in roadmap order.
 *
 * Phase 0 decisions (agreed in Phase 3):
 * - Blocked areas get no UI at all. (Backtest history opened in Phase 9, Trading
 *   Records in Phase 15, Notifications in Phase 16; none is blocked now.)
 * - Deferred areas are listed with `planned: true`: shown greyed out with a
 *   "Planned" tag, never clickable.
 */
export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Where the link goes. */
  to: string;
  /** The item is highlighted for any page under this path. */
  match: string;
  planned?: false;
}

export interface PlannedNavItem {
  label: string;
  icon: LucideIcon;
  planned: true;
}

export interface NavGroup {
  label: string;
  items: (NavItem | PlannedNavItem)[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, to: '/app/dashboard', match: '/app/dashboard' },
    ],
  },
  {
    label: 'Research',
    items: [
      { label: 'Strategies', icon: Layers, to: '/app/strategies', match: '/app/strategies' },
      { label: 'Strategy Builder', icon: Blocks, to: '/app/builder/new', match: '/app/builder' },
      {
        label: 'Instruments',
        icon: ChartCandlestick,
        to: '/app/instruments',
        match: '/app/instruments',
      },
      { label: 'Indicators', icon: Activity, to: '/app/indicators', match: '/app/indicators' },
      { label: 'Market Regime', icon: Compass, to: '/app/regime', match: '/app/regime' },
      { label: 'Scoring', icon: Trophy, to: '/app/scoring', match: '/app/scoring' },
    ],
  },
  {
    label: 'Backtesting',
    items: [
      {
        label: 'New Backtest',
        icon: CirclePlay,
        to: '/app/backtests/new',
        match: '/app/backtests',
      },
      {
        label: 'Backtest history',
        icon: History,
        to: '/app/executions',
        match: '/app/executions',
      },
      {
        label: 'Validation',
        icon: ShieldCheck,
        to: '/app/validation',
        match: '/app/validation',
      },
      {
        label: 'Portfolio Backtest',
        icon: ChartSpline,
        to: '/app/portfolio-backtests',
        match: '/app/portfolio-backtests',
      },
      {
        label: 'Trading Records',
        icon: ReceiptText,
        to: '/app/records',
        match: '/app/records',
      },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { label: 'Portfolios', icon: ChartPie, to: '/app/portfolios', match: '/app/portfolios' },
      { label: 'Live Trading (Paper)', icon: Radio, to: '/app/live', match: '/app/live' },
    ],
  },
  {
    label: 'Account',
    items: [
      {
        label: 'Notifications',
        icon: Bell,
        to: '/app/notifications',
        match: '/app/notifications',
      },
      { label: 'Brokers', icon: Landmark, to: '/app/brokers', match: '/app/brokers' },
      { label: 'Profile', icon: UserRound, to: '/app/profile', match: '/app/profile' },
    ],
  },
];

/** True when `pathname` is the item's section or a page inside it. */
export function isActive(item: NavItem, pathname: string): boolean {
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
