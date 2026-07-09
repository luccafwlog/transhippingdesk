import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../services/queryKeys'
import {
  listBlTransshipments,
  listVoyageOmissions,
  omitVoyageEscala,
  setBlCod,
  setBlTransshipment,
  type BlTransshipment,
  type VoyageOmission,
} from '../services/transshipments'

export function useVoyageTransshipments(voyageId: number | null) {
  return useQuery({
    queryKey: voyageId ? queryKeys.transshipments.byVoyage(voyageId) : ['transshipments', 'none'],
    enabled: voyageId != null,
    queryFn: async (): Promise<{ omissions: VoyageOmission[]; transshipments: BlTransshipment[] }> => {
      const omissions = await listVoyageOmissions(voyageId as number)
      const transshipments = (await Promise.all(omissions.map((omission) => listBlTransshipments(omission.id)))).flat()
      return { omissions, transshipments }
    },
  })
}

export function useOmitEscala(voyageId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: omitVoyageEscala,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.transshipments.byVoyage(voyageId) })
      queryClient.invalidateQueries({ queryKey: ['voyage-pod-schedules'] })
      queryClient.invalidateQueries({ queryKey: ['voyage-timeline'] })
      queryClient.invalidateQueries({ queryKey: ['voyages'] })
      queryClient.invalidateQueries({ queryKey: ['bls'] })
      queryClient.invalidateQueries({ queryKey: ['lineup-tv-v3'] })
      queryClient.invalidateQueries({ queryKey: ['lineup-tv-display-v2'] })
    },
  })
}

export function useSetBlDisposition(voyageId: number) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.transshipments.byVoyage(voyageId) })
    queryClient.invalidateQueries({ queryKey: ['bls'] })
    queryClient.invalidateQueries({ queryKey: ['voyages'] })
  }
  return {
    setTransshipment: useMutation({ mutationFn: setBlTransshipment, onSuccess: invalidate }),
    setCod: useMutation({ mutationFn: setBlCod, onSuccess: invalidate }),
  }
}
