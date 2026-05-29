import { useQuery } from '@tanstack/react-query'
import {
  listConsolidatableReceivables,
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
