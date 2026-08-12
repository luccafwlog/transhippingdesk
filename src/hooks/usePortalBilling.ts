import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import {
  portalCreateConsolidation,
  portalGetCurrentRoe,
  portalGetDemurrageInvoiceDetail,
  portalInvoiceDetails,
  portalListConsolidatableReceivables,
  portalListDemurrageInvoices,
  portalListInvoices,
  portalObsoleteConsolidation,
} from '../services/portalBilling'
import { queryKeys } from '../services/queryKeys'

export function usePortalCurrentRoe() {
  const { isAuthenticated } = usePortalAuth()
  return useQuery({
    queryKey: queryKeys.portal.currentRoe(),
    enabled: isAuthenticated,
    queryFn: portalGetCurrentRoe,
    staleTime: 60 * 60 * 1000,
  })
}

export function usePortalConsolidatableReceivables() {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-consolidatable-receivables'],
    enabled: isAuthenticated,
    queryFn: () => portalListConsolidatableReceivables(),
  })
}

export function usePortalInvoices() {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-invoices'],
    enabled: isAuthenticated,
    queryFn: () => portalListInvoices(),
  })
}

export function usePortalInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-invoice-detail', invoiceId],
    enabled: Boolean(isAuthenticated && invoiceId),
    queryFn: () => portalInvoiceDetails(Number(invoiceId)),
  })
}

export function usePortalDemurrageInvoices() {
  const { isAuthenticated } = usePortalAuth()
  // ponytail: refresh is governed by query lifecycle; re-enable Realtime only
  // after demurrage_invoices is explicitly added to supabase_realtime.

  return useQuery({
    queryKey: ['portal-demurrage-invoices'],
    enabled: isAuthenticated,
    queryFn: () => portalListDemurrageInvoices(),
  })
}

export function usePortalDemurrageInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  return useQuery({
    queryKey: ['portal-demurrage-invoice-detail', invoiceId],
    enabled: Boolean(isAuthenticated && invoiceId),
    queryFn: () => portalGetDemurrageInvoiceDetail(Number(invoiceId)),
  })
}

export function usePortalCreateConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()

  return useMutation({
    mutationFn: (payload: { receivableIds: number[] }) => portalCreateConsolidation(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
      ])
      await refreshOverview()
    },
  })
}

export function usePortalObsoleteConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()

  return useMutation({
    mutationFn: (invoiceId: number) => portalObsoleteConsolidation(invoiceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
      ])
      await refreshOverview()
    },
  })
}
