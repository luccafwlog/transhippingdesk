import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelInvoice,
  createInvoiceFromBls,
  createInvoiceFromGraniteBls,
  listBillingCustomers,
  listBillingReadyBls,
  listBillingReadyGraniteBls,
  listInvoiceDetails,
  listInvoiceLinksByBls,
  listInvoices,
  registerInvoicePayment,
  type BillingReadyBlFilters,
  type InvoiceFilters,
} from '../services/billing'

export function useInvoices(filters: InvoiceFilters) {
  return useQuery({
    queryKey: ['invoices', filters],
    queryFn: () => listInvoices(filters),
  })
}

export function useInvoiceDetail(invoiceId?: number | null) {
  return useQuery({
    queryKey: ['invoice-detail', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: () => listInvoiceDetails(Number(invoiceId)),
  })
}

export function useBillingReadyBls(filters?: BillingReadyBlFilters) {
  return useQuery({
    queryKey: ['billing-ready-bls', filters],
    queryFn: () => listBillingReadyBls(filters),
  })
}

export function useBillingReadyGraniteBls(filters?: { customerId?: number | null }) {
  return useQuery({
    queryKey: ['billing-ready-granite-bls', filters],
    queryFn: () => listBillingReadyGraniteBls(filters),
  })
}

export function useInvoiceLinks(blIds: string[]) {
  return useQuery({
    queryKey: ['invoice-links', blIds.slice().sort().join(',')],
    enabled: blIds.length > 0,
    queryFn: () => listInvoiceLinksByBls(blIds),
  })
}

export function useBillingCustomers(search: string) {
  return useQuery({
    queryKey: ['billing-customers', search],
    queryFn: () => listBillingCustomers(search),
  })
}

export function useCreateInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createInvoiceFromBls,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['billing-ready-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bl-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-detail'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}

export function useCreateGraniteInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createInvoiceFromGraniteBls,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['billing-ready-granite-bls'] }),
      ])
    },
  })
}

export function useRegisterInvoicePayment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: registerInvoicePayment,
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-detail', variables.invoiceId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-detail'] }),
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
        queryClient.invalidateQueries({ queryKey: ['invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['invoice-detail', variables.invoiceId] }),
        queryClient.invalidateQueries({ queryKey: ['billing-ready-bls'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-detail'] }),
      ])
    },
  })
}
