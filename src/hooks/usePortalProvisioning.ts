import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listPortalProvisioning, listPortalProvisioningEvents, listPortalProvisioningQueue, returnToAnalysis, setProvisioningException } from '../services/portalProvisioning'

export const PORTAL_PROVISIONING_QUERY_KEY = ['portal-provisioning'] as const

export function usePortalProvisioning() {
  return useQuery({ queryKey: PORTAL_PROVISIONING_QUERY_KEY, queryFn: listPortalProvisioningQueue })
}

export function usePortalProvisioningForCustomer(customerId: number | null) {
  return useQuery({
    queryKey: [...PORTAL_PROVISIONING_QUERY_KEY, 'customer', customerId],
    enabled: customerId !== null,
    queryFn: () => listPortalProvisioning(customerId!),
    select: (rows) => rows[0],
  })
}

export function usePortalEvents(customerId: number | null) {
  return useQuery({
    queryKey: [...PORTAL_PROVISIONING_QUERY_KEY, 'events', customerId],
    enabled: Boolean(customerId),
    queryFn: () => listPortalProvisioningEvents(customerId!),
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
