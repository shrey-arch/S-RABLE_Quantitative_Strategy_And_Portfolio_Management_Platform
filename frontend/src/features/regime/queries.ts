import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import { POLL_MS } from '@/features/backtests/backtest-model';
import type { DateRange } from '@/features/instruments/market-data';
import type { TrainRequest } from './regime-model';

/** 404 from /regime/current or /regime/history: no model has been trained yet. */
export const isNoModel = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * Every regime model, newest first (GET /regime/models). Asked for again while one
 * is training; when it finishes, the current regime and history are refreshed
 * (a new READY model becomes the active one).
 */
export function useRegimeModels() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.regime.models(),
    queryFn: () => unwrap(api.GET('/regime/models')),
    refetchInterval: (q) => (q.state.data?.some((m) => m.status === 'TRAINING') ? POLL_MS : false),
  });
  const training = (query.data ?? []).filter((m) => m.status === 'TRAINING').map((m) => m.id);
  const previous = useRef<string[]>([]);
  useEffect(() => {
    const finished = previous.current.filter((id) => !training.includes(id));
    previous.current = training;
    if (finished.length) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.regime.all });
      // Regime compatibility on the Scoring page follows the active model.
      void queryClient.invalidateQueries({ queryKey: queryKeys.scoring.all });
    }
  });
  return query;
}

/** One model with its model card (GET /regime/models/{id}). */
export function useRegimeModel(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.regime.model(id ?? ''),
    queryFn: () =>
      unwrap(api.GET('/regime/models/{model_id}', { params: { path: { model_id: id! } } })),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === 'TRAINING' ? POLL_MS : false),
  });
}

/** The active model's regime on the reference instrument's last bar (GET /regime/current). */
export function useCurrentRegime() {
  return useQuery({
    queryKey: queryKeys.regime.current(),
    queryFn: () => unwrap(api.GET('/regime/current')),
  });
}

/** Closes with each day's regime, periods and transitions (GET /regime/history). */
export function useRegimeHistory(range: DateRange) {
  return useQuery({
    queryKey: queryKeys.regime.history(range),
    queryFn: () =>
      unwrap(
        api.GET('/regime/history', {
          params: {
            query: {
              ...(range.start ? { start_date: range.start } : {}),
              ...(range.end ? { end_date: range.end } : {}),
            },
          },
        }),
      ),
  });
}

/** POST /regime/models: starts training (202). 409 = one is already training. */
export function useTrainRegimeModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TrainRequest) => unwrap(api.POST('/regime/models', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.regime.all });
    },
  });
}
