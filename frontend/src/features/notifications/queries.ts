import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { UNREAD_POLL_MS, type Notification, type NotificationFilters } from './notification-model';

/** The user's notifications, newest first, filtered by the backend. */
export function useNotifications(filters: NotificationFilters) {
  return useQuery({
    queryKey: queryKeys.notifications.list(filters),
    queryFn: () => unwrap(api.GET('/notifications', { params: { query: filters } })),
  });
}

/** Unread count for the header bell, from GET /notifications/unread-count. */
export function useUnreadCount(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications.unread(),
    queryFn: async () => (await unwrap(api.GET('/notifications/unread-count'))).unread,
    refetchInterval: UNREAD_POLL_MS,
    enabled,
  });
}

/** Mark read or unread (PATCH is_read); the list and the bell refresh after. */
export function useSetRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; is_read: boolean }): Promise<Notification> =>
      unwrap(
        api.PATCH('/notifications/{notification_id}', {
          params: { path: { notification_id: input.id } },
          body: { is_read: input.is_read },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await unwrap(
        api.DELETE('/notifications/{notification_id}', {
          params: { path: { notification_id: id } },
        }),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}
