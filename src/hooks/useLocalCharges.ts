import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { calculateBlLocalCharges, listBlLocalChargeLines } from '../services/localCharges'

export function useBlLocalChargeLines(blId?: string) {
  return useQuery({
    queryKey: ['bl-local-charge-lines', blId],
    enabled: Boolean(blId),
    queryFn: () => listBlLocalChargeLines(blId!),
  })
}

export function useCalculateBlLocalCharges(blId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (options?: { actorId?: string | null; recalculate?: boolean }) =>
      calculateBlLocalCharges(blId!, { actorId: options?.actorId ?? null, recalculate: options?.recalculate ?? true }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bl-local-charge-lines', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bl-detail', blId] }),
        queryClient.invalidateQueries({ queryKey: ['bls'] }),
        queryClient.invalidateQueries({ queryKey: ['voyages'] }),
      ])
    },
  })
}

