import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import {
  portalListNotifications,
  portalMarkAllNotificationsRead,
  portalMarkNotificationRead,
  portalNotificationUnreadCount,
} from '../services/portalBilling'

export function usePortalUnreadCount() {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-unread-count'],
    enabled: Boolean(isAuthenticated),
    refetchInterval: 30_000,
    queryFn: () => portalNotificationUnreadCount(),
  })
}

export function usePortalNotifications(enabled = true) {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-notifications'],
    enabled: Boolean(isAuthenticated && enabled),
    refetchInterval: 30_000,
    queryFn: () => portalListNotifications(),
  })
}

export function usePortalMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => portalMarkNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['portal-unread-count'] })
    },
  })
}

export function usePortalMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => portalMarkAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-notifications'] })
      queryClient.invalidateQueries({ queryKey: ['portal-unread-count'] })
    },
  })
}
