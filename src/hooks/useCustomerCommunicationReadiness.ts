import { useQuery } from '@tanstack/react-query'
import { fetchCustomerLocalChargesCommunicationReadiness } from '../services/customerCommunicationReadiness'
import { fetchCustomerVoyageCommunicationStatus } from '../services/customerFinanceCommunications'
import { queryKeys } from '../services/queryKeys'
import { supabase } from '../services/supabase'

export function useCustomerCommunicationReadiness(voyageId: number | null, customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.readiness(voyageId, customerId),
    enabled: voyageId != null && customerId != null,
    queryFn: () => fetchCustomerLocalChargesCommunicationReadiness(voyageId!, customerId!),
  })
}

export function useCustomerVoyageCommunicationStatus(voyageId: number | null, customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.status(voyageId, customerId),
    enabled: voyageId != null && customerId != null && typeof (supabase as { from?: unknown }).from === 'function',
    queryFn: () => fetchCustomerVoyageCommunicationStatus(voyageId!, customerId!),
  })
}
