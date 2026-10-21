import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/query-keys';
import type { OrderAction, RecordFilters, RecordRef } from './records-model';

/** 404 = not found or not this user's record (the backend does not say which). */
export const isNotAvailable = (error: unknown) =>
  error instanceof ApiError && (error.status === 404 || error.status === 422);

const noRetryOnMissing = (count: number, error: unknown) => !isNotAvailable(error) && count < 2;

export function useOrders(filters: RecordFilters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.records.list('orders', filters as Record<string, string>),
    queryFn: () => unwrap(api.GET('/orders', { params: { query: filters as never } })),
    enabled,
  });
}

export function useTrades(filters: RecordFilters & { order_id?: string }, enabled = true) {
  return useQuery({
    queryKey: queryKeys.records.list('trades', filters as Record<string, string>),
    queryFn: () => unwrap(api.GET('/trades', { params: { query: filters as never } })),
    enabled,
  });
}

export function usePositions(filters: RecordFilters, enabled = true) {
  return useQuery({
    queryKey: queryKeys.records.list('positions', filters as Record<string, string>),
    queryFn: () => unwrap(api.GET('/positions', { params: { query: filters as never } })),
    enabled,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.records.detail('order', id ?? ''),
    queryFn: () => unwrap(api.GET('/orders/{order_id}', { params: { path: { order_id: id! } } })),
    enabled: Boolean(id),
    retry: noRetryOnMissing,
  });
}

export function useTrade(id: string | null) {
  return useQuery({
    queryKey: queryKeys.records.detail('trade', id ?? ''),
    queryFn: () => unwrap(api.GET('/trades/{trade_id}', { params: { path: { trade_id: id! } } })),
    enabled: Boolean(id),
    retry: noRetryOnMissing,
  });
}

export function usePosition(id: string | null) {
  return useQuery({
    queryKey: queryKeys.records.detail('position', id ?? ''),
    queryFn: () =>
      unwrap(api.GET('/positions/{position_id}', { params: { path: { position_id: id! } } })),
    enabled: Boolean(id),
    retry: noRetryOnMissing,
  });
}

/** How many records a run has stored (GET /executions/{id}/records). */
export function useRecordCounts(executionId: string) {
  return useQuery({
    queryKey: queryKeys.records.counts(executionId),
    queryFn: () =>
      unwrap(
        api.GET('/executions/{execution_id}/records', {
          params: { path: { execution_id: executionId } },
        }),
      ),
  });
}

/** Store a completed backtest's records (for runs completed before Phase 15). */
export function useStoreRecords(executionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/executions/{execution_id}/records', {
          params: { path: { execution_id: executionId } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.records.all }),
  });
}

/** Simulated record maintenance: an order's status change. A 400 says why it is not allowed. */
export function useOrderAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: OrderAction }) => {
      const path = { params: { path: { order_id: id } } };
      switch (action) {
        case 'open':
          return unwrap(api.POST('/orders/{order_id}/open', path));
        case 'complete':
          return unwrap(api.POST('/orders/{order_id}/complete', path));
        case 'cancel':
          return unwrap(api.POST('/orders/{order_id}/cancel', path));
        case 'reject':
          return unwrap(api.POST('/orders/{order_id}/reject', path));
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.records.all }),
  });
}

/** Simulated record maintenance: delete one stored record. */
export function useDeleteRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ref: RecordRef) => {
      if (ref.kind === 'order')
        await unwrap(api.DELETE('/orders/{order_id}', { params: { path: { order_id: ref.id } } }));
      else if (ref.kind === 'trade')
        await unwrap(api.DELETE('/trades/{trade_id}', { params: { path: { trade_id: ref.id } } }));
      else
        await unwrap(
          api.DELETE('/positions/{position_id}', { params: { path: { position_id: ref.id } } }),
        );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.records.all }),
  });
}
