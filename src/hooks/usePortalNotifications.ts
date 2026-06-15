import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import {
  portalListNotifications,
  portalMarkAllNotificationsRead,
  portalMarkNotificationRead,
} from '../services/portalBilling'

export function usePortalNotifications(enabled = true) {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-notifications'],
    enabled: Boolean(isAuthenticated && enabled),
    refetchInterval: 30_000, // Poll a cada 30s
    queryFn: () => portalListNotifications(),
  })
}

export function usePortalMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => portalMarkNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal-notifications'] }),
  })
}

export function usePortalMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => portalMarkAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal-notifications'] }),
  })
}
