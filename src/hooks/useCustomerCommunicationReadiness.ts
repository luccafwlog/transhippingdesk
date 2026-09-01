import { useQuery } from '@tanstack/react-query'
import { fetchCustomerLocalChargesCommunicationReadiness } from '../services/customerCommunicationReadiness'
import { queryKeys } from '../services/queryKeys'

export function useCustomerCommunicationReadiness(voyageId: number | null, customerId: number | null) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.readiness(voyageId, customerId),
    enabled: voyageId != null && customerId != null,
    queryFn: () => fetchCustomerLocalChargesCommunicationReadiness(voyageId!, customerId!),
  })
}
