import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createConsolidatedInvoice,
  listConsolidatableReceivables,
  listInvoiceRefunds,
  registerLedgerInvoicePayment,
  settleInvoiceRefund,
  type ConsolidatableReceivableFilters,
} from '../services/billingLedger'
import { queryKeys } from '../services/queryKeys'

export function useConsolidatableReceivables(filters: ConsolidatableReceivableFilters) {
  return useQuery({
    queryKey: queryKeys.billingLedger.consolidatableReceivables(filters),
    queryFn: () => listConsolidatableReceivables(filters),
    enabled: Boolean(filters.customerId),
  })
}

function useLedgerInvalidation() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.billingLedger.all() })
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() })
    qc.invalidateQueries({ queryKey: queryKeys.bls.all() })
    qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    qc.invalidateQueries({ queryKey: queryKeys.customers.detail() })
    qc.invalidateQueries({ queryKey: ['invoice-detail'] })
    qc.invalidateQueries({ queryKey: ['invoice-refunds'] })
    qc.invalidateQueries({ queryKey: ['financial-alerts'] })
    qc.invalidateQueries({ queryKey: ['op-count'] })
  }
}

export function useInvoiceRefunds(invoiceId?: number | null) {
  return useQuery({
    queryKey: ['invoice-refunds', invoiceId],
    enabled: Boolean(invoiceId),
    queryFn: () => listInvoiceRefunds(Number(invoiceId)),
  })
}

export function useSettleInvoiceRefund() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: settleInvoiceRefund,
    onSuccess: invalidate,
  })
}

export function useCreateConsolidatedInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: createConsolidatedInvoice,
    onSuccess: invalidate,
  })
}
export function useRegisterLedgerInvoicePayment() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: registerLedgerInvoicePayment,
    onSuccess: invalidate,
  })
}
