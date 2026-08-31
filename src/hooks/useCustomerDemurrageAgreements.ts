import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  deleteCustomerDemurrageAgreement,
  listCustomerDemurrageAgreements,
  saveCustomerDemurrageAgreement,
  toggleCustomerDemurrageAgreementActive,
  type CustomerDemurrageAgreementFilters,
} from '../services/demurrage/customerDemurrageAgreements'
import type { CustomerDemurrageAgreementFormInput } from '../types/customerDemurrageAgreements'

export function useCustomerDemurrageAgreements(filters?: CustomerDemurrageAgreementFilters) {
  return useQuery({
    queryKey: queryKeys.demurrage.customerAgreements(filters),
    queryFn: () => listCustomerDemurrageAgreements(filters),
  })
}

function useInvalidateCustomerAgreements() {
  const queryClient = useQueryClient()
  return (customerId?: number) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.demurrage.customerAgreements() })
    if (customerId) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerFicha.demurrageAgreements(customerId) })
    }
  }
}

export function useSaveCustomerDemurrageAgreement() {
  const invalidate = useInvalidateCustomerAgreements()
  return useMutation({
    mutationFn: (input: CustomerDemurrageAgreementFormInput) => saveCustomerDemurrageAgreement(input),
    onSuccess: (_, variables) => invalidate(variables.customer_id),
  })
}

export function useDeleteCustomerDemurrageAgreement() {
  const invalidate = useInvalidateCustomerAgreements()
  return useMutation({
    mutationFn: ({ id }: { id: number; customerId?: number }) => deleteCustomerDemurrageAgreement(id),
    onSuccess: (_, variables) => invalidate(variables.customerId),
  })
}

export function useToggleCustomerDemurrageAgreementActive() {
  const invalidate = useInvalidateCustomerAgreements()
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean; customerId?: number }) =>
      toggleCustomerDemurrageAgreementActive(id, active),
    onSuccess: (_, variables) => invalidate(variables.customerId),
  })
}
