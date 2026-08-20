import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendReviewPortalInvite, completeReviewCustomerGroup, type CompleteReviewCustomerGroupInput, type ReviewCustomerGroupResult } from '../services/reviewCustomerGroup'
import { PORTAL_PROVISIONING_QUERY_KEY } from './usePortalProvisioning'

export type ReviewCustomerGroupMutationResult = {
  onboarding: ReviewCustomerGroupResult
  portalInvite: 'not_requested' | 'sent' | 'failed'
}

export function useReviewCustomerGroup() {
  const queryClient = useQueryClient()
  return useMutation<ReviewCustomerGroupMutationResult, Error, CompleteReviewCustomerGroupInput>({
    mutationFn: async (input) => {
      const onboarding = await completeReviewCustomerGroup(input)
      if (!input.sendPortalInvite) return { onboarding, portalInvite: 'not_requested' }
      try {
        await sendReviewPortalInvite(onboarding.customer.id, input.email)
        return { onboarding, portalInvite: 'sent' }
      } catch {
        return { onboarding, portalInvite: 'failed' }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-lookup'] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['local-charge-pendencies'] }),
        queryClient.invalidateQueries({ queryKey: PORTAL_PROVISIONING_QUERY_KEY }),
      ])
    },
  })
}
