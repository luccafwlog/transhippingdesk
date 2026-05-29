import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createConsolidatedInvoice,
  createIndividualInvoiceFromReceivable,
  listConsolidatableReceivables,
  obsoleteConsolidatedInvoice,
  registerLedgerInvoicePayment,
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
    qc.invalidateQueries({ queryKey: ['invoice-detail'] })
    qc.invalidateQueries({ queryKey: ['financial-alerts'] })
  }
}

export function useCreateConsolidatedInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: createConsolidatedInvoice,
    onSuccess: invalidate,
  })
}

export function useCreateIndividualInvoiceFromReceivable() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: createIndividualInvoiceFromReceivable,
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

export function useObsoleteConsolidatedInvoice() {
  const invalidate = useLedgerInvalidation()
  return useMutation({
    mutationFn: obsoleteConsolidatedInvoice,
    onSuccess: invalidate,
  })
}
