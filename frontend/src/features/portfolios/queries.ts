import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type {
  CreateRequest,
  PortfolioAccount,
  RebalanceRequest,
  StateRequest,
  TargetRequest,
} from './portfolio-model';

/**
 * 404 = not found or another user's portfolio (the backend does not say which).
 * 422 = the id in the address is not a valid id.
 */
export const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** The user's portfolios with their saved cash, invested value and equity. */
export function usePortfolios() {
  return useQuery({
    queryKey: queryKeys.portfolios.list(),
    queryFn: () => unwrap(api.GET('/portfolio/accounts')),
  });
}

/** One saved portfolio: cash, holdings, weights (GET /portfolio/accounts/{id}). */
export function usePortfolio(id: string) {
  return useQuery({
    queryKey: queryKeys.portfolios.detail(id),
    queryFn: () =>
      unwrap(
        api.GET('/portfolio/accounts/{portfolio_id}', {
          params: { path: { portfolio_id: id } },
        }),
      ),
    retry: (count, error) => !isNotAvailable(error) && count < 2,
  });
}

export function useCreatePortfolio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRequest) => unwrap(api.POST('/portfolio/accounts', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.portfolios.all }),
  });
}

/** Saves cash and holdings (PUT .../state). The only call here that changes anything. */
export function useSaveState(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: StateRequest) =>
      unwrap(
        api.PUT('/portfolio/accounts/{portfolio_id}/state', {
          params: { path: { portfolio_id: id } },
          body,
        }),
      ),
    onSuccess: (saved: PortfolioAccount) => {
      queryClient.setQueryData(queryKeys.portfolios.detail(id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.portfolios.list() });
    },
  });
}

/** Target allocation: a calculation, never cached or saved. */
export function useTarget() {
  return useMutation({
    mutationFn: (body: TargetRequest) => unwrap(api.POST('/portfolio/target', { body })),
  });
}

/** Rebalance plan: a calculation, never cached or saved. */
export function useRebalance() {
  return useMutation({
    mutationFn: (body: RebalanceRequest) => unwrap(api.POST('/portfolio/rebalance', { body })),
  });
}

/** Latest stored daily close of each asset, to prefill prices. */
export function useAssetPrices(assets: string[]) {
  return useQuery({
    queryKey: queryKeys.portfolios.prices(assets),
    queryFn: () => unwrap(api.GET('/portfolio/prices', { params: { query: { asset: assets } } })),
    enabled: assets.length > 0,
  });
}
