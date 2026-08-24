import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  countUnreadInternalNotifications,
  listInternalNotifications,
  markAllInternalNotificationsRead,
  markInternalNotificationRead,
} from '../services/alerts'
import type { InternalNotificationCursor } from '../services/alerts'

export const INTERNAL_NOTIFICATIONS_QUERY_KEY = ['internal-notifications'] as const
export const INTERNAL_NOTIFICATIONS_COUNT_QUERY_KEY = ['internal-notifications-unread-count'] as const

export function useInternalNotifications(enabled = true, before: InternalNotificationCursor | null = null) {
  return useQuery({
    queryKey: [...INTERNAL_NOTIFICATIONS_QUERY_KEY, before?.createdAt ?? null, before?.id ?? null],
    queryFn: () => listInternalNotifications({ includeRead: false, limit: 20, before }),
    enabled,
    refetchInterval: 60_000,
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
