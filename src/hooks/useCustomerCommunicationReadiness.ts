import { useQuery } from '@tanstack/react-query'
import { fetchCustomerVoyageCommunicationStatus } from '../services/customerFinanceCommunications'
import { queryKeys } from '../services/queryKeys'
import { supabase } from '../services/supabase'

export function useCustomerVoyageCommunicationStatus(voyageId: number | null, customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.status(voyageId, customerId),
    enabled: voyageId != null && customerId != null && typeof (supabase as { from?: unknown }).from === 'function',
    queryFn: () => fetchCustomerVoyageCommunicationStatus(voyageId!, customerId!),
  })
}
