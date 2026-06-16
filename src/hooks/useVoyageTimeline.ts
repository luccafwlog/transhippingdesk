import { useQuery } from '@tanstack/react-query'
import { fetchVoyageTimelineSources } from '../services/voyageTimeline'

/** Fontes da linha do tempo da viagem aberta no detalhe. */
export function useVoyageTimeline(voyageId: number | null | undefined) {
  return useQuery({
    queryKey: ['voyage-timeline', voyageId == null ? '' : String(voyageId)],
    enabled: voyageId != null,
    staleTime: 60_000,
    queryFn: () => fetchVoyageTimelineSources(Number(voyageId)),
  })
}
