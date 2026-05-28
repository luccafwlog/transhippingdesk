import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelInvoice,
  createInvoiceFromBls,
  createInvoiceFromGraniteBls,
  getBillingReadyBlDiagnostics,
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

export function useBillingReadyBls(filters?: BillingReadyBlFilters) {
  return useQuery({
    queryKey: queryKeys.billingReady.bls(filters),
    queryFn: () => listBillingReadyBls(filters),
  })
}

export function useBillingReadyBlDiagnostics(filters?: BillingReadyBlFilters) {
  return useQuery({
    queryKey: queryKeys.billingReady.diagnostics(filters),
    queryFn: () => getBillingReadyBlDiagnostics(filters),
  })
}

export function useBillingReadyGraniteBls(filters?: { customerId?: number | null }) {
  return useQuery({
    queryKey: queryKeys.billingReady.graniteBls(filters),
    queryFn: () => listBillingReadyGraniteBls(filters),
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

export function useCreateInvoice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createInvoiceFromBls,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingReady.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingReady.diagnostics() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bls.summary() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.voyages.all() }),
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
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.billingReady.graniteBls() }),
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
