import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import { fetchPortalScheduleVoyages } from '../services/portalScheduleVoyages'

export function usePortalScheduleVoyages() {
  const { isAuthenticated } = usePortalAuth()
  const scope = usePortalScope()

  return useQuery({
    queryKey: ['portal-schedule-voyages', scope.mode, scope.customerId],
    enabled: isAuthenticated || scope.mode === 'inspect',
    queryFn: () => fetchPortalScheduleVoyages(scope),
  })
}
