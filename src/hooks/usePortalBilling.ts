import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import {
  portalCreateConsolidation,
  portalGetDemurrageInvoiceDetail,
  portalInvoiceDetails,
  portalListConsolidatableReceivables,
  portalListDemurrageInvoices,
  portalListInvoices,
} from '../services/portalBilling'

export function usePortalConsolidatableReceivables() {
  const { sessionToken } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-consolidatable-receivables', sessionToken],
    enabled: Boolean(sessionToken),
    queryFn: () => portalListConsolidatableReceivables(sessionToken!),
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

export function usePortalDemurrageInvoices() {
  const { sessionToken } = usePortalAuth()
  return useQuery({
    queryKey: ['portal-demurrage-invoices', sessionToken],
    enabled: Boolean(sessionToken),
    queryFn: () => portalListDemurrageInvoices(sessionToken!),
  })
}

export function usePortalDemurrageInvoiceDetail(invoiceId?: number | null) {
  const { sessionToken } = usePortalAuth()
  return useQuery({
    queryKey: ['portal-demurrage-invoice-detail', sessionToken, invoiceId],
    enabled: Boolean(sessionToken && invoiceId),
    queryFn: () => portalGetDemurrageInvoiceDetail(sessionToken!, Number(invoiceId)),
  })
}

export function usePortalCreateConsolidation() {
  const queryClient = useQueryClient()
  const { sessionToken, refreshOverview } = usePortalAuth()

  return useMutation({
    mutationFn: async (payload: { receivableIds: number[] }) => {
      if (!sessionToken) {
        throw new Error('Sessao do portal indisponivel.')
      }

      return portalCreateConsolidation({
        sessionToken,
        receivableIds: payload.receivableIds,
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
      ])
      await refreshOverview()
    },
  })
}
