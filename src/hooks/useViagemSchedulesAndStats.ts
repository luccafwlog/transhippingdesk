import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import { fetchVoyagesWithUnpaidBls } from '../services/voyages'
import { listVoyagePolSchedules, listVoyagePodSchedulesByVoyageIds, listVoyageRouteCeMasters, type VoyagePodSchedule } from '../services/voyageRouteSchedules'
import { fetchExportSchedulesByVoyageIds, type VoyageExportSchedulesByPort } from '../services/voyageExportSchedules'

function groupPodSchedulesByVoyageId(
  schedules: Map<string, VoyagePodSchedule> | undefined,
): Map<number, VoyagePodSchedule[]> {
  const grouped = new Map<number, VoyagePodSchedule[]>()
  for (const schedule of schedules?.values() ?? []) {
    const current = grouped.get(schedule.voyageId) ?? []
    current.push(schedule)
    grouped.set(schedule.voyageId, current)
  }
  return grouped
}

export function useViagemSchedulesAndStats(voyageIds: number[], polEntityIds: string[]) {
  const { data: voyagesWithUnpaidBls } = useQuery({
    queryKey: queryKeys.voyages.billingStatus(voyageIds),
    enabled: voyageIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchVoyagesWithUnpaidBls(voyageIds),
  })

  const { data: polSchedules } = useQuery({
    queryKey: queryKeys.voyages.polSchedules(polEntityIds),
    enabled: polEntityIds.length > 0,
    queryFn: () => listVoyagePolSchedules(polEntityIds),
  })

  const { data: podSchedulesRaw } = useQuery({
    queryKey: queryKeys.voyages.podSchedules(voyageIds),
    enabled: voyageIds.length > 0,
    queryFn: () => listVoyagePodSchedulesByVoyageIds(voyageIds),
  })

  const { data: exportSchedulesData } = useQuery<Map<number, VoyageExportSchedulesByPort>>({
    queryKey: queryKeys.voyages.exportSchedules(voyageIds),
    enabled: voyageIds.length > 0,
    queryFn: () => fetchExportSchedulesByVoyageIds(voyageIds),
  })

  const { data: routeCeMasters } = useQuery({
    queryKey: queryKeys.voyages.routeCeMasters(voyageIds),
    enabled: voyageIds.length > 0,
    queryFn: () => listVoyageRouteCeMasters(voyageIds),
  })

  const podSchedulesByVoyage = useMemo(() => groupPodSchedulesByVoyageId(podSchedulesRaw), [podSchedulesRaw])

  return {
    voyagesWithUnpaidBls,
    polSchedules,
    podSchedules: podSchedulesRaw,
    podSchedulesByVoyage,
    exportSchedulesData,
    routeCeMasters,
  }
}
