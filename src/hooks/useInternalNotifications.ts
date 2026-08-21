import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listInternalNotifications, markInternalNotificationRead } from '../services/alerts'

export const INTERNAL_NOTIFICATIONS_QUERY_KEY = ['internal-notifications'] as const

export function useInternalNotifications(enabled = true) {
  return useQuery({
    queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY,
    queryFn: () => listInternalNotifications(false),
    enabled,
    refetchInterval: 60_000,
  })
}

export function useMarkInternalNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markInternalNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INTERNAL_NOTIFICATIONS_QUERY_KEY }),
  })
}
