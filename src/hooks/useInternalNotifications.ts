import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  countUnreadInternalNotifications,
  fetchAlertEntityLabels,
  listInternalNotifications,
  markAllInternalNotificationsRead,
  markInternalNotificationRead,
} from '../services/alerts'
import type { AlertEntityLabels, InternalNotification, InternalNotificationCursor } from '../services/alerts'
import { queryKeys } from '../services/queryKeys'

export const INTERNAL_NOTIFICATIONS_QUERY_KEY = queryKeys.alerts.internalNotifications()
export const INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY = queryKeys.alerts.internalNotificationsUnreadCount()

export function useInternalNotifications(enabled = true, before: InternalNotificationCursor | null = null) {
  return useQuery({
    queryKey: [...INTERNAL_NOTIFICATIONS_QUERY_KEY, before?.createdAt ?? null, before?.id ?? null],
    queryFn: () => listInternalNotifications({ includeRead: false, limit: 20, before }),
    enabled,
    refetchInterval: 60_000,
  })
}

/**
 * O sino guarda so a chave surrogate da entidade (`entity_id`), igual a fila de
 * /alertas. Esta consulta traduz a pagina inteira em lote e roda separada da
 * lista, para o menu abrir sem esperar a traducao: enquanto ela nao volta,
 * `formatAlertEntity` cai no id.
 */
export function useInternalNotificationEntityLabels(
  notifications: InternalNotification[],
  before: InternalNotificationCursor | null = null,
) {
  return useQuery<AlertEntityLabels>({
    // A chave acompanha o conteudo da pagina (id mais recente + tamanho): o sino
    // recarrega a lista a cada 60s e uma notificacao nova precisa resolver o
    // proprio rotulo em vez de esperar o staleTime.
    queryKey: queryKeys.alerts.internalNotificationEntityLabels(
      `${before?.createdAt ?? ''}:${before?.id ?? ''}:${notifications[0]?.id ?? ''}:${notifications.length}`,
    ),
    // `payload` do sino e o `metadata` do alerta: e de la que sai o TXID do PIX.
    queryFn: () => fetchAlertEntityLabels(
      notifications.map((notification) => ({
        entity_type: notification.entity_type,
        entity_id: notification.entity_id,
        metadata: notification.payload ?? null,
      })),
    ),
    enabled: notifications.length > 0,
    staleTime: 5 * 60_000,
  })
}

export function useUnreadInternalNotificationCount(enabled = true) {
  return useQuery({
    queryKey: INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY,
    queryFn: countUnreadInternalNotifications,
    enabled,
    refetchInterval: 30_000,
  })
}

export function useMarkInternalNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markInternalNotificationRead,
    onMutate: async (notificationId: number) => {
      await queryClient.cancelQueries({ queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY })
      await queryClient.cancelQueries({ queryKey: INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY })
      const previousLists = queryClient.getQueriesData({ queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY })
      const previousCount = queryClient.getQueryData(INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY)
      const readAt = new Date().toISOString()
      queryClient.setQueriesData(
        { queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY },
        (old: unknown) =>
          Array.isArray(old)
            ? old.map((item) =>
                (item as InternalNotification).id === notificationId
                  ? { ...(item as InternalNotification), read_at: (item as InternalNotification).read_at ?? readAt }
                  : item,
              )
            : old,
      )
      queryClient.setQueryData(INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY, (count: unknown) =>
        typeof count === 'number' ? Math.max(0, count - 1) : count,
      )
      return { previousLists, previousCount }
    },
    onError: (_error, _notificationId, context) => {
      // Restaura o estado otimista (item + contador) para permitir retry.
      for (const [key, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, data)
      }
      queryClient.setQueryData(INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY, context?.previousCount)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY })
    },
  })
}

export function useMarkAllInternalNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markAllInternalNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY })
    },
  })
}
