import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listImportEffects,
  retryImportEffect,
  type ImportEffect,
} from '../services/importEffects'
import { queryKeys } from '../services/queryKeys'

const ACTIVE_STATES = new Set<ImportEffect['status']>(['pending', 'running', 'retry_wait'])

export function useImportEffects(entityId?: string | null, limit = 100) {
  const queryClient = useQueryClient()
  const normalizedEntityId = entityId?.trim() ?? ''
  const queryKey = queryKeys.importEffects.byEntity(normalizedEntityId)

  const query = useQuery({
    queryKey,
    enabled: Boolean(normalizedEntityId),
    queryFn: () => listImportEffects({ entityId: normalizedEntityId, limit }),
    // Enquanto a cauda está ativa, atualiza o resultado sem exigir Realtime.
    // Quando termina, o ciclo normal de foco da janela mantém a tela reabrível
    // sem polling indefinido.
    refetchInterval: (current) => {
      const effects = current.state.data
      return effects?.some((effect) => ACTIVE_STATES.has(effect.status)) ? 5_000 : false
    },
  })

  const retryMutation = useMutation({
    mutationFn: (input: { effectId: number; justification: string }) =>
      retryImportEffect(input.effectId, input.justification),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey })
    },
  })

  return { ...query, retryMutation }
}
