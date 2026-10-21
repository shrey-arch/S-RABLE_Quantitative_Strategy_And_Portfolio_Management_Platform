import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import type { components } from '@/api/schema';

export type Strategy = components['schemas']['StrategyResponse'];

/** The built-in strategies (GET /strategy-registry). They never change at runtime. */
export function useRegistry() {
  return useQuery({
    queryKey: queryKeys.registry.list(),
    queryFn: () => unwrap(api.GET('/strategy-registry')),
    staleTime: Infinity,
  });
}

/** The current user's strategies (GET /strategies, filtered to the user by the backend). */
export function useMyStrategies() {
  return useQuery({
    queryKey: queryKeys.strategies.list(),
    queryFn: () => unwrap(api.GET('/strategies')),
  });
}

/**
 * Turns a strategy on or off (PATCH /strategies/{id} with is_active only).
 * The list is refreshed from the server afterwards, so it always shows the saved value.
 */
export function useSetStrategyActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      unwrap(
        api.PATCH('/strategies/{strategy_id}', {
          params: { path: { strategy_id: vars.id } },
          body: { is_active: vars.isActive },
        }),
      ),
    onSuccess: (strategy) => {
      toast.success(`${strategy.name} is now ${strategy.is_active ? 'active' : 'inactive'}.`);
    },
    onError: (error) => {
      toast.error(`Could not change the status: ${error.message}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.strategies.all }),
  });
}

/** One of the user's strategies. The backend answers 404 for ids that are not the user's. */
export function useStrategy(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.strategies.detail(id),
    queryFn: () =>
      unwrap(api.GET('/strategies/{strategy_id}', { params: { path: { strategy_id: id } } })),
    enabled,
  });
}

/** DELETE /strategies/{id} (204). The list is refreshed; the deleted detail is dropped from the cache. */
export function useDeleteStrategy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (strategy: Pick<Strategy, 'id' | 'name'>) =>
      unwrap(
        api.DELETE('/strategies/{strategy_id}', {
          params: { path: { strategy_id: strategy.id } },
        }),
      ).then(() => strategy),
    onSuccess: (strategy) => {
      queryClient.removeQueries({ queryKey: queryKeys.strategies.detail(strategy.id) });
      toast.success(`${strategy.name} was deleted.`);
    },
    // Success or not (e.g. already deleted elsewhere), the list is reloaded from the server.
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.strategies.list() }),
  });
}

type CreateBody = components['schemas']['CreateStrategyRequest'];
type UpdateBody = components['schemas']['UpdateStrategyRequest'];

/**
 * Checks template parameters exactly as a backtest would, without saving anything
 * (POST /strategy-registry/{key}/validate). Bad values throw a 422 ApiError whose
 * message is the backend's sentence, e.g. "lookback must be greater than 0.".
 */
export function validateTemplateParams(key: string, parameters: Record<string, unknown>) {
  return unwrap(
    api.POST('/strategy-registry/{strategy_key}/validate', {
      params: { path: { strategy_key: key } },
      body: { parameters: parameters as Record<string, string | number | boolean> },
    }),
  );
}

/** POST /strategies. The list is refreshed from the server. */
export function useCreateStrategy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBody) => unwrap(api.POST('/strategies', { body })),
    onSuccess: (strategy) => {
      queryClient.setQueryData(queryKeys.strategies.detail(strategy.id), strategy);
      void queryClient.invalidateQueries({ queryKey: queryKeys.strategies.list() });
      toast.success(`${strategy.name} was created.`);
    },
  });
}

/** PATCH /strategies/{id} with the edited fields. Detail and list show the saved result. */
export function useUpdateStrategy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateBody }) =>
      unwrap(
        api.PATCH('/strategies/{strategy_id}', {
          params: { path: { strategy_id: vars.id } },
          body: vars.body,
        }),
      ),
    onSuccess: (strategy) => {
      queryClient.setQueryData(queryKeys.strategies.detail(strategy.id), strategy);
      void queryClient.invalidateQueries({ queryKey: queryKeys.strategies.list() });
      toast.success(`${strategy.name} was saved.`);
    },
  });
}
