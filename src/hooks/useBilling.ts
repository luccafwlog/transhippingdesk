import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelInvoice,
  listBillingCustomers,
  listInvoiceDetails,
  listInvoiceLinksByBls,
  listInvoices,
  registerInvoicePayment,
  type InvoiceFilters,
} from '../services/billing'
import { queryKeys } from '../services/queryKeys'

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: queryKeys.invoices.list(filters),
    queryFn: () => listInvoices(filters),
  })
}

export function useInvoiceDetail(invoiceId?: number | null) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(invoiceId),
    enabled: Boolean(invoiceId),
    queryFn: () => listInvoiceDetails(Number(invoiceId)),
  })
}
export function useInvoiceLinks(blIds: string[]) {
  return useQuery({
    queryKey: queryKeys.invoices.links(blIds),
    enabled: blIds.length > 0,
    queryFn: () => listInvoiceLinksByBls(blIds),
  })
}

export function useBillingCustomers(search: string) {
  return useQuery({
    queryKey: queryKeys.billingReady.customers(search),
    queryFn: () => listBillingCustomers(search),
  })
}
export function useRegisterInvoicePayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: registerInvoicePayment,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.invoiceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
      ])
    },
  })
}

export function useCancelInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: cancelInvoice,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.detail(variables.invoiceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingReady.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
      ])
    },
  })
}
