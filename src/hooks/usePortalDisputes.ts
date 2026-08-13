import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePortalScope } from './usePortalScope'
import { portalOpenDemurrageDispute } from '../services/portalBilling'

export function usePortalOpenDispute() {
  const queryClient = useQueryClient()
  const scope = usePortalScope()
  return useMutation({
    mutationFn: (input: { demurrageInvoiceId: number; reason: string }) =>
      portalOpenDemurrageDispute(input.demurrageInvoiceId, input.reason, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal-demurrage-invoices'] })
    },
  })
}
