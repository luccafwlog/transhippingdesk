import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { portalGetProfile, portalUpdateProfile, type PortalProfile } from '../services/portalBilling'

export function usePortalProfile() {
  const { overview, refreshOverview } = usePortalAuth()
  const queryClient = useQueryClient()

  const profileQuery = useQuery({
    queryKey: ['portal-profile'],
    enabled: Boolean(overview),
    queryFn: () => portalGetProfile(),
  })

  const updateProfile = useMutation({
    mutationFn: (input: {
      contactEmail?: string | null
      phone?: string | null
      address?: string | null
      city?: string | null
      state?: string | null
      zip?: string | null
    }) => portalUpdateProfile(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-profile'] })
      await refreshOverview()
    },
  })

  return {
    ...profileQuery,
    updateProfile,
    fallbackContactEmail: overview?.contact_email ?? '',
  } as typeof profileQuery & {
    data: PortalProfile | undefined
    updateProfile: typeof updateProfile
    fallbackContactEmail: string
  }
}
