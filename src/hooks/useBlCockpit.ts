import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { buildVoyagePodEntityId, buildVoyagePolEntityId, listVoyagePodSchedules, listVoyagePolSchedules } from '../services/voyageRouteSchedules'
import { listVoyageOmissions, listBlTransshipmentByBlId } from '../services/transshipments'
import type { BLDetail } from '../types/database'

export function useBlCockpit(bl: BLDetail | undefined) {
  return useQuery({
    queryKey: queryKeys.bls.cockpit(bl?.id),
    enabled: Boolean(bl?.id && bl?.voyage_id),
    queryFn: async () => {
      const voyageId = Number(bl!.voyage_id)
      const polId = buildVoyagePolEntityId(voyageId, bl!.pol)
      const podId = buildVoyagePodEntityId(voyageId, bl!.pod)
      const [polSchedules, podSchedules, omissions, transshipment] = await Promise.all([
        listVoyagePolSchedules([polId]),
        listVoyagePodSchedules([podId]),
        listVoyageOmissions(voyageId),
        listBlTransshipmentByBlId(bl!.id),
      ])
      const omission = transshipment
        ? omissions.find((o) => o.id === transshipment.omissionId) ?? null
        : null
      return { polSchedule: polSchedules.get(polId) ?? null, podSchedule: podSchedules.get(podId) ?? null, omission, transshipment }
    },
  })
}
