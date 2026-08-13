import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import { portalListOperationBls } from '../services/portalOperation'

export function usePortalOperationBls() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-operation-bls', scope.mode, scope.customerId],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => portalListOperationBls(scope),
  })
}
