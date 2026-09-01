import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchBlCommunicationHistory,
  fetchCustomerCommunicationConference,
  fetchCustomerCommunicationHistory,
  fetchCustomerCommunicationSavedTemplates,
  saveCustomerCommunicationSavedTemplate,
  type CustomerCommunicationFilters,
} from '../services/customerCommunications'
import {
  dispatchCustomerCommunication,
  type CustomerCommunicationDispatchInput,
} from '../services/customerCommunicationDispatches'
import type { CustomerCommunicationKind } from '../services/customerCommunicationTemplates'
import type { CustomerCommunicationNature } from '../types/database'
import { queryKeys } from '../services/queryKeys'
import { afterCustomerCommunicationDispatched } from '../services/cacheEffects'

export function useCustomerCommunicationConference(input: {
  filters: CustomerCommunicationFilters
  kind: CustomerCommunicationKind
  nature?: CustomerCommunicationNature
  enabled?: boolean
}) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.conference(input.filters, input.kind, input.nature),
    enabled: input.enabled ?? true,
    queryFn: () => fetchCustomerCommunicationConference({ filters: input.filters, kind: input.kind, nature: input.nature }),
  })
}

export function useCustomerCommunicationHistory(customerId?: number) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.history(customerId),
    queryFn: () => fetchCustomerCommunicationHistory(customerId),
  })
}

export function useCustomerCommunicationSavedTemplates() {
  return useQuery({
    queryKey: [...queryKeys.customerCommunications.all(), 'saved-templates'],
    queryFn: fetchCustomerCommunicationSavedTemplates,
  })
}

export function useSaveCustomerCommunicationSavedTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveCustomerCommunicationSavedTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...queryKeys.customerCommunications.all(), 'saved-templates'] }),
  })
}

export function useBlCommunicationHistory(blId?: string) {
  return useQuery({
    queryKey: queryKeys.customerCommunications.byBl(blId ?? 'nil'),
    enabled: Boolean(blId),
    queryFn: () => fetchBlCommunicationHistory(blId!),
  })
}

export function useDispatchCustomerCommunication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CustomerCommunicationDispatchInput) => dispatchCustomerCommunication(input),
    onSuccess: async (_result, input) => {
      await afterCustomerCommunicationDispatched(queryClient, { customerId: input.customerId, blIds: input.blIds })
    },
  })
}
