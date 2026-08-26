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
