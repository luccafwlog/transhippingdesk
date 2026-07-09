import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { fetchPortalScheduleVoyages } from '../services/portalScheduleVoyages'

export function usePortalScheduleVoyages() {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-schedule-voyages'],
    enabled: isAuthenticated,
    queryFn: fetchPortalScheduleVoyages,
  })
}
