import { useQuery } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { listVesselSchedules } from '../services/vesselSchedules'

export function useVesselSchedules() {
  const { isAuthenticated } = usePortalAuth()

  return useQuery({
    queryKey: ['portal-vessel-schedules'],
    enabled: isAuthenticated,
    queryFn: listVesselSchedules,
  })
}
