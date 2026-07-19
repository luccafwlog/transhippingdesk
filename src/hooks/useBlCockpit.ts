import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { buildVoyagePodEntityId, buildVoyagePolEntityId, listVoyagePodSchedules, listVoyagePolSchedules } from '../services/voyageRouteSchedules'
import { listVoyageOmissions, listBlTransshipments } from '../services/transshipments'
import type { BLDetail } from '../types/database'

export function useBlCockpit(bl: BLDetail | undefined) {
  return useQuery({
    queryKey: queryKeys.bls.cockpit(bl?.id),
    enabled: Boolean(bl?.id && bl?.voyage_id),
    queryFn: async () => {
      const voyageId = Number(bl!.voyage_id)
      const polId = buildVoyagePolEntityId(voyageId, bl!.pol)
      const podId = buildVoyagePodEntityId(voyageId, bl!.pod)
      const [polSchedules, podSchedules, omissions] = await Promise.all([
        listVoyagePolSchedules([polId]),
        listVoyagePodSchedules([podId]),
        listVoyageOmissions(voyageId),
      ])
      const omission = omissions.find((o) => o.omittedPod === String(bl!.pod ?? '').trim().toUpperCase()) ?? null
      const transshipment = omission ? (await listBlTransshipments(omission.id)).find((t) => t.blId === bl!.id) ?? null : null
      return { polSchedule: polSchedules.get(polId) ?? null, podSchedule: podSchedules.get(podId) ?? null, omission, transshipment }
    },
  })
}
