import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { portalOpenDemurrageDispute } from '../services/portalBilling'

export function usePortalOpenDispute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { demurrageInvoiceId: number; reason: string }) =>
      portalOpenDemurrageDispute(input.demurrageInvoiceId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-demurrage-invoices'] })
    },
  })
}
