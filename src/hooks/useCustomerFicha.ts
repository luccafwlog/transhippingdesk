import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { fetchCustomerDemurrageInvoices, fetchCustomerManualChargeBls, fetchCustomerPayments, fetchCustomerPendingReconciliation, fetchCustomerRateOverrides, fetchCustomerReceivables, fetchCustomerRunningDemurrage, fetchCustomerTimelineSources } from '../services/customerFicha'
import type { CustomerContact } from '../types/database'

function useFichaQuery<T>(customerId: number | null, key: readonly unknown[], queryFn: () => Promise<T>, enabled = customerId != null) {
  return useQuery({ queryKey: key, enabled, queryFn })
}
export function useCustomerDemurrageInvoices(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.demurrageInvoices(customerId ?? 0), () => fetchCustomerDemurrageInvoices(customerId!)) }
export function useCustomerReceivables(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.receivables(customerId ?? 0), () => fetchCustomerReceivables(customerId!)) }
export function useCustomerPayments(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.payments(customerId ?? 0), () => fetchCustomerPayments(customerId!)) }
export function useCustomerRateOverrides(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.rateOverrides(customerId ?? 0), () => fetchCustomerRateOverrides(customerId!)) }
export function useCustomerManualChargeBls(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.manualChargeBls(customerId ?? 0), () => fetchCustomerManualChargeBls(customerId!)) }
export function useCustomerPendingReconciliation(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.pendingReconciliation(customerId ?? 0), () => fetchCustomerPendingReconciliation(customerId!)) }
export function useCustomerRunningDemurrage(customerId: number | null) { return useFichaQuery(customerId, queryKeys.customerFicha.runningDemurrage(customerId ?? 0), () => fetchCustomerRunningDemurrage(customerId!)) }
export function useCustomerTimeline(customerId: number | null, contacts: Array<Pick<CustomerContact, 'id' | 'name' | 'created_at'>> | undefined, bls: Array<{ id: string; created_at: string | null }> | undefined) {
  return useFichaQuery(customerId, queryKeys.customerFicha.timeline(customerId ?? 0), () => fetchCustomerTimelineSources(customerId!, contacts ?? [], bls ?? []), customerId != null && contacts !== undefined && bls !== undefined)
}
