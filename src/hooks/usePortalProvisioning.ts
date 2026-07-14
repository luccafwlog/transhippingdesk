import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listPortalProvisioning, returnToAnalysis, setProvisioningException } from '../services/portalProvisioning'

export const PORTAL_PROVISIONING_QUERY_KEY = ['portal-provisioning'] as const

export function usePortalProvisioning() {
  return useQuery({ queryKey: PORTAL_PROVISIONING_QUERY_KEY, queryFn: listPortalProvisioning })
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
