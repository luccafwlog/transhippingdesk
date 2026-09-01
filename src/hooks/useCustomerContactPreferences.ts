import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateCustomerContactPreference } from '../services/customerContactPreferences'
import { queryKeys } from '../services/queryKeys'
import type { CustomerCommunicationNature } from '../types/database'

export function useUpdateCustomerContactPreference() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      customerId: number
      contactId: number
      nature: CustomerCommunicationNature
      enabled: boolean
    }) => updateCustomerContactPreference(input),
    onSuccess: async (_, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.customers.detail() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.timeline(input.customerId) }),
      ])
    },
  })
}
