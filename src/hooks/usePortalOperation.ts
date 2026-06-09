import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { portalListOperationBls } from '../services/portalOperation'

export function usePortalOperationBls() {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-operation-bls'],
    enabled: isAuthenticated,
    queryFn: () => portalListOperationBls(),
  })
}
