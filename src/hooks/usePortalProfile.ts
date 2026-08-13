import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import { portalGetProfile, portalUpdateProfile, type PortalProfile } from '../services/portalBilling'

export function usePortalProfile() {
  const { overview, refreshOverview } = usePortalAuth()
  const scope = usePortalScope()
  const queryClient = useQueryClient()

  const profileQuery = useQuery({
    queryKey: ['portal-profile', scope.mode, scope.customerId],
    enabled: Boolean(scope.overview ?? overview),
    queryFn: () => portalGetProfile(scope),
  })

  const updateProfile = useMutation({
    mutationFn: (input: {
      contactEmail?: string | null
      phone?: string | null
      address?: string | null
      city?: string | null
      state?: string | null
      zip?: string | null
    }) => portalUpdateProfile(input, scope),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-profile'] })
      await refreshOverview()
    },
  })

  return {
    ...profileQuery,
    updateProfile,
    fallbackContactEmail: (scope.overview ?? overview)?.contact_email ?? '',
  } as typeof profileQuery & {
    data: PortalProfile | undefined
    updateProfile: typeof updateProfile
    fallbackContactEmail: string
  }
}
