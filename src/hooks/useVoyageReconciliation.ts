import { useQuery } from '@tanstack/react-query'
import { reconcileBaplieWithManifest } from '../services/baplieReconciliation'

/**
 * Conciliação Baplie ↔ Manifesto de uma única viagem (a aberta no detalhe).
 * Por viagem e relativamente cara — por isso não roda na lista/rail.
 * Compartilha a chave de cache com a página Baplie.
 */
export function useVoyageReconciliation(voyageId: number | null | undefined) {
  return useQuery({
    queryKey: ['baplie-reconciliation', voyageId == null ? '' : String(voyageId)],
    enabled: voyageId != null,
    staleTime: 60_000,
    queryFn: () => reconcileBaplieWithManifest(Number(voyageId)),
  })
}
