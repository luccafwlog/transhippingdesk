import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import {
  portalCreateConsolidation,
  portalGetCurrentRoe,
  portalGetDemurrageInvoiceDetail,
  portalInvoiceDetails,
  portalListConsolidatableReceivables,
  portalListDemurrageInvoices,
  portalListDemurrageInvoicesPage,
  portalListInvoices,
  portalListInvoicesPage,
  portalObsoleteConsolidation,
} from '../services/portalBilling'
import { EMPTY_PORTAL_BILLING_FILTERS, type PortalBillingFilters } from '../lib/portalBillingFilters'
import { queryKeys } from '../services/queryKeys'

export function usePortalCurrentRoe() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  return useQuery({
    queryKey: queryKeys.portal.currentRoe(),
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalGetCurrentRoe(scope),
    staleTime: 60 * 60 * 1000,
  })
}

export function usePortalConsolidatableReceivables() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-consolidatable-receivables', scope.mode, scope.customerId],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalListConsolidatableReceivables(scope),
  })
}

export function usePortalInvoices() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-invoices', scope.mode, scope.customerId],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalListInvoices(scope),
  })
}

export function usePortalInvoicesPage(filters: PortalBillingFilters = EMPTY_PORTAL_BILLING_FILTERS, page = 0, pageSize = 25) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-invoices-page', scope.mode, scope.customerId, filters, page, pageSize],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalListInvoicesPage(filters, page, pageSize, scope),
    placeholderData: (previous) => previous,
  })
}

export function usePortalInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-invoice-detail', scope.mode, scope.customerId, invoiceId],
    enabled: Boolean((isAuthenticated || scope.mode === 'inspect') && invoiceId),
    queryFn: () => portalInvoiceDetails(Number(invoiceId), scope),
  })
}

export function usePortalDemurrageInvoices() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  // ponytail: refresh is governed by query lifecycle; re-enable Realtime only
  // after demurrage_invoices is explicitly added to supabase_realtime.

  return useQuery({
    queryKey: ['portal-demurrage-invoices', scope.mode, scope.customerId],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalListDemurrageInvoices(scope),
  })
}

export function usePortalDemurrageInvoicesPage(filters: PortalBillingFilters = EMPTY_PORTAL_BILLING_FILTERS, page = 0, pageSize = 25) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-demurrage-invoices-page', scope.mode, scope.customerId, filters, page, pageSize],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalListDemurrageInvoicesPage(filters, page, pageSize, scope),
    placeholderData: (previous) => previous,
  })
}

export function usePortalDemurrageInvoiceDetail(invoiceId?: number | null) {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()
  return useQuery({
    queryKey: ['portal-demurrage-invoice-detail', scope.mode, scope.customerId, invoiceId],
    enabled: Boolean((isAuthenticated || scope.mode === 'inspect') && invoiceId),
    queryFn: () => portalGetDemurrageInvoiceDetail(Number(invoiceId), scope),
  })
}

export function usePortalCreateConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const scope = usePortalScope()

  return useMutation({
    mutationFn: (payload: { receivableIds: number[] }) => portalCreateConsolidation(payload, scope),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices-page'] }),
      ])
      await refreshOverview()
    },
  })
}

export function usePortalObsoleteConsolidation() {
  const queryClient = useQueryClient()
  const { refreshOverview } = usePortalAuth()
  const scope = usePortalScope()

  return useMutation({
    mutationFn: (invoiceId: number) => portalObsoleteConsolidation(invoiceId, scope),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['portal-consolidatable-receivables'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['portal-invoices-page'] }),
      ])
      await refreshOverview()
    },
  })
}
