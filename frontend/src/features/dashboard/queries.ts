import { useQueries, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import type { PortfolioListItem, PortfolioState } from '@/api/portfolio-types';
import { queryKeys } from '@/api/query-keys';
import { sumMoney } from '@/lib/money';

/**
 * Dashboard data. Every widget has its own query, so each one loads, retries
 * and fails on its own. Only routes that require login and return the user's
 * own data are used (Phase 0 / backend review).
 */

export function useStrategies() {
  return useQuery({
    queryKey: queryKeys.strategies.list(),
    queryFn: () => unwrap(api.GET('/strategies')),
  });
}

export function useBrokerAccounts() {
  return useQuery({
    queryKey: queryKeys.brokers.list(),
    queryFn: () => unwrap(api.GET('/brokers/accounts')),
  });
}

export function useActiveInstruments() {
  return useQuery({
    queryKey: queryKeys.instruments.list({ activeOnly: true }),
    queryFn: () => unwrap(api.GET('/instruments', { params: { query: { active_only: true } } })),
  });
}

export function usePortfolioList() {
  return useQuery({
    queryKey: queryKeys.portfolios.list(),
    queryFn: async () => (await unwrap(api.GET('/portfolio/accounts'))) as PortfolioListItem[],
  });
}

/**
 * Portfolio count and total simulated equity.
 * The list has no equity, so each portfolio's state is loaded and its
 * `total_equity` added up. If any one fails, the total is not shown at all:
 * a partial total would be wrong.
 */
export function usePortfolioSummary() {
  const list = usePortfolioList();
  const portfolios = list.data ?? [];
  const states = useQueries({
    queries: portfolios.map((p) => ({
      queryKey: queryKeys.portfolios.detail(p.id),
      queryFn: async () =>
        (await unwrap(
          api.GET('/portfolio/accounts/{portfolio_id}', {
            params: { path: { portfolio_id: p.id } },
          }),
        )) as PortfolioState,
    })),
  });

  const failed = states.find((s) => s.isError);
  const loading = list.isPending || states.some((s) => s.isPending);
  const error = list.error ?? failed?.error ?? null;

  let totalEquity: string | null = null;
  if (!loading && !error) {
    totalEquity = sumMoney(states.map((s) => s.data!.total_equity));
  }

  return {
    isPending: loading && !error,
    isError: Boolean(error),
    error,
    count: list.data?.length ?? null,
    totalEquity,
    refetch: () => {
      if (list.isError) void list.refetch();
      for (const s of states) if (s.isError) void s.refetch();
    },
  };
}
