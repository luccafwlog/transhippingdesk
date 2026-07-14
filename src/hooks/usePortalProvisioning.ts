import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listPortalProvisioningQueue, returnToAnalysis, setProvisioningException } from '../services/portalProvisioning'

export const PORTAL_PROVISIONING_QUERY_KEY = ['portal-provisioning'] as const

export function usePortalProvisioning() {
  return useQuery({ queryKey: PORTAL_PROVISIONING_QUERY_KEY, queryFn: listPortalProvisioningQueue })
}

export function usePortalEvents(customerId: number | null) {
  return useQuery({
    queryKey: [...PORTAL_PROVISIONING_QUERY_KEY, 'events', customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const { data, error } = await import('../services/supabase').then(({ supabase }) => supabase.from('portal_provisioning_events').select('*').eq('customer_id', customerId!).order('created_at', { ascending: false }))
      if (error) throw error
      return data ?? []
    },
  })
}

export function useSetProvisioningException() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, reason }: { customerId: number; reason: string }) => setProvisioningException(customerId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PORTAL_PROVISIONING_QUERY_KEY }),
  })
}

export function useReturnToAnalysis() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ customerId, reason }: { customerId: number; reason: string }) => returnToAnalysis(customerId, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: PORTAL_PROVISIONING_QUERY_KEY }),
  })
}
