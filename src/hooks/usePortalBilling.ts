import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import {
  portalCreateConsolidation,
  portalInvoiceDetails,
  portalListInvoices,
  portalListPendingBls,
} from '../services/portalBilling'

export function usePortalPendingBls() {
  const { sessionToken } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-pending-bls', sessionToken],
    enabled: Boolean(sessionToken),
    queryFn: () => portalListPendingBls(sessionToken!),
  })
}

export function usePortalInvoices() {
  const { sessionToken } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-invoices', sessionToken],
    enabled: Boolean(sessionToken),
    queryFn: () => portalListInvoices(sessionToken!),
  })
}

export function usePortalInvoiceDetail(invoiceId?: number | null) {
  const { sessionToken } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-invoice-detail', sessionToken, invoiceId],
    enabled: Boolean(sessionToken && invoiceId),
    queryFn: () => portalInvoiceDetails(sessionToken!, Number(invoiceId)),
  })
}

export function usePortalCreateConsolidation() {
  const queryClient = useQueryClient()
  const { sessionToken, refreshOverview } = usePortalAuth()

  return useMutation({
    mutationFn: async (payload: { blIds: string[]; dueDate?: string | null; notes?: string | null }) => {
      if (!sessionToken) {
        throw new Error('Sessao do portal indisponivel.')
      }

      return portalCreateConsolidation({
        sessionToken,
        blIds: payload.blIds,
        dueDate: payload.dueDate ?? null,
        notes: payload.notes ?? null,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-pending-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
      ])
      await refreshOverview()
    },
  })
}
