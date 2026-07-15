import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listPortalProvisioningEvents, listPortalProvisioningQueue, returnToAnalysis, setProvisioningException } from '../services/portalProvisioning'
import { supabase } from '../services/supabase'

export const PORTAL_PROVISIONING_QUERY_KEY = ['portal-provisioning'] as const

export function usePortalProvisioning() {
  return useQuery({ queryKey: PORTAL_PROVISIONING_QUERY_KEY, queryFn: () => listPortalProvisioningQueue() })
}

export function usePortalProvisioningForCustomer(customerId: number | null) {
  return useQuery({
    queryKey: [...PORTAL_PROVISIONING_QUERY_KEY, 'customer', customerId],
    enabled: customerId !== null,
    queryFn: () => listPortalProvisioningQueue(customerId!),
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

function invalidatePortalQueries(queryClient: ReturnType<typeof useQueryClient>, customerId?: number) {
  void queryClient.invalidateQueries({ queryKey: PORTAL_PROVISIONING_QUERY_KEY })
  if (customerId) void queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] })
}

export function useSendPortalInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, recoveryEmail, source }: { customerId: number; recoveryEmail: string; source: string }) => {
      const { error } = await supabase.functions.invoke('portal-invite-send', { body: { customer_id: customerId, recovery_email: recoveryEmail, recovery_email_source: source } })
      if (error) throw error
    },
    onSuccess: (_, variables) => invalidatePortalQueries(queryClient, variables.customerId),
  })
}

export function useCancelPortalInvite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, reason }: { customerId: number; reason: string }) => { const { error } = await supabase.rpc('portal_cancel_invite', { p_customer_id: customerId, p_reason: reason }); if (error) throw error },
    onSuccess: (_, variables) => invalidatePortalQueries(queryClient, variables.customerId),
  })
}

export function useSuspendPortalAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, action, reason }: { customerId: number; action: 'suspend' | 'reactivate'; reason: string }) => {
      const { error } = await supabase.functions.invoke('portal-account-suspend', { body: { customer_id: customerId, action, reason } })
      if (error) throw error
    },
    onSuccess: (_, variables) => invalidatePortalQueries(queryClient, variables.customerId),
  })
}

export function useAssistedEmailChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ customerId, email, reason }: { customerId: number; email: string; reason: string }) => { const { error } = await supabase.rpc('portal_assisted_email_change', { p_customer_id: customerId, p_new_email: email, p_reason: reason }); if (error) throw error },
    onSuccess: (_, variables) => invalidatePortalQueries(queryClient, variables.customerId),
  })
}
