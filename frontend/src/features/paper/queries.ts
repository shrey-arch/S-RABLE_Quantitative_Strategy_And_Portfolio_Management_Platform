import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import {
  PAPER_POLL_MS,
  type DeployBody,
  type DeploymentAction,
  type JournalBody,
  type OrderBody,
} from './paper-model';

/** Every read matches open orders on the server first, so polling also fills orders. */
export function usePaperAccount() {
  return useQuery({
    queryKey: queryKeys.paper.account(),
    queryFn: () => unwrap(api.GET('/paper/account')),
    refetchInterval: PAPER_POLL_MS,
  });
}

export function usePaperQuotes(ids: string[]) {
  return useQuery({
    queryKey: queryKeys.paper.quotes(ids),
    queryFn: () => unwrap(api.GET('/paper/quotes', { params: { query: { instrument_id: ids } } })),
    enabled: ids.length > 0,
    refetchInterval: PAPER_POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function usePaperOrders() {
  return useQuery({
    queryKey: queryKeys.paper.orders(),
    queryFn: () => unwrap(api.GET('/paper/orders')),
    refetchInterval: PAPER_POLL_MS,
  });
}

export function usePaperHoldings() {
  return useQuery({
    queryKey: queryKeys.paper.holdings(),
    queryFn: () => unwrap(api.GET('/paper/holdings')),
    refetchInterval: PAPER_POLL_MS,
  });
}

export function usePaperFills() {
  return useQuery({
    queryKey: queryKeys.paper.fills(),
    queryFn: () => unwrap(api.GET('/paper/fills')),
    refetchInterval: PAPER_POLL_MS,
  });
}

export function usePaperCharges() {
  return useQuery({
    queryKey: queryKeys.paper.charges(),
    queryFn: () => unwrap(api.GET('/paper/charges')),
    staleTime: Infinity,
  });
}

/** Estimated price, charges and funds check for the ticket (nothing is placed). */
export function useOrderPreview(body: OrderBody | null) {
  return useQuery({
    queryKey: queryKeys.paper.preview(body ?? {}),
    queryFn: () => unwrap(api.POST('/paper/orders/preview', { body: body! })),
    enabled: body !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

function usePaperMutation<T, R>(run: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.paper.all }),
  });
}

export const usePlaceOrder = () =>
  usePaperMutation((body: OrderBody) => unwrap(api.POST('/paper/orders', { body })));

export const useModifyOrder = () =>
  usePaperMutation(
    (input: { id: string; quantity?: number; price?: number; trigger_price?: number }) =>
      unwrap(
        api.PATCH('/paper/orders/{order_id}', {
          params: { path: { order_id: input.id } },
          body: {
            quantity: input.quantity,
            price: input.price,
            trigger_price: input.trigger_price,
          },
        }),
      ),
  );

export const useCancelOrder = () =>
  usePaperMutation((id: string) =>
    unwrap(api.DELETE('/paper/orders/{order_id}', { params: { path: { order_id: id } } })),
  );

export const useResetAccount = () =>
  usePaperMutation((initial_cash: number) =>
    unwrap(api.POST('/paper/account/reset', { body: { initial_cash } })),
  );

export const useUpdateSettings = () =>
  usePaperMutation((body: { slippage_bps?: number; brokerage_per_order?: number }) =>
    unwrap(api.PATCH('/paper/account/settings', { body })),
  );

export const useSetWatchlist = () =>
  usePaperMutation((instrument_ids: string[]) =>
    unwrap(api.PUT('/paper/watchlist', { body: { instrument_ids } })),
  );

export const useJournal = () =>
  usePaperMutation((input: { id: string; body: JournalBody }) =>
    unwrap(
      api.PATCH('/paper/orders/{order_id}/journal', {
        params: { path: { order_id: input.id } },
        body: input.body,
      }),
    ),
  );

// --- strategy deployments ----------------------------------------------------------

export function useDeployments() {
  return useQuery({
    queryKey: queryKeys.paper.deployments(),
    queryFn: () => unwrap(api.GET('/paper/deployments')),
    refetchInterval: PAPER_POLL_MS,
  });
}

export function useDeployment(id: string) {
  return useQuery({
    queryKey: queryKeys.paper.deployment(id),
    queryFn: () =>
      unwrap(
        api.GET('/paper/deployments/{deployment_id}', {
          params: { path: { deployment_id: id } },
        }),
      ),
    enabled: Boolean(id),
    refetchInterval: PAPER_POLL_MS,
    retry: (count, error) => !isNotFound(error) && count < 2,
  });
}

/** 404 (not the user's) or 422 (not an id): the page says it is not available. */
export const isNotFound = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

/** The account's value at each close (daily snapshots) and its metrics. */
export function useAccountPerformance() {
  return useQuery({
    queryKey: queryKeys.paper.performance(),
    queryFn: () => unwrap(api.GET('/paper/performance')),
    refetchInterval: PAPER_POLL_MS,
  });
}

export const useDeploy = () =>
  usePaperMutation((body: DeployBody) => unwrap(api.POST('/paper/deployments', { body })));

/** Processes the user's deployments up to the latest settled close (the daily job's work). */
export const useRunDue = () =>
  usePaperMutation((_: void) => unwrap(api.POST('/paper/deployments/run-due')));

const ACTION_PATHS = {
  pause: '/paper/deployments/{deployment_id}/pause',
  resume: '/paper/deployments/{deployment_id}/resume',
  stop: '/paper/deployments/{deployment_id}/stop',
} as const;

export function useDeploymentAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; action: DeploymentAction }) =>
      unwrap(
        api.POST(ACTION_PATHS[input.action], { params: { path: { deployment_id: input.id } } }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.paper.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.validations.all });
    },
  });
}

/** Validation stage 5: the validated strategy on the paper account (POST .../from-validation). */
export function useStartPaperStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { validationId: string; capital: number; loss_limit: number | null }) =>
      unwrap(
        api.POST('/paper/deployments/from-validation/{validation_id}', {
          params: { path: { validation_id: input.validationId } },
          body: { capital: input.capital, loss_limit: input.loss_limit },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.paper.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.validations.all });
    },
  });
}
