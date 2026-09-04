import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePortalAuth } from './usePortalAuth'
import { usePortalScope } from './usePortalScope'
import {
  portalGetContactConfiguration,
  portalSaveContactConfiguration,
  type PortalContactConfiguration,
  type PortalContactDraft,
} from '../services/portalContactConfiguration'
import { portalErrorMessage } from '../lib/portalErrorMessage'

export function usePortalContactConfiguration() {
  const { overview, refreshOverview } = usePortalAuth()
  const scope = usePortalScope()
  const queryClient = useQueryClient()

  const contactConfigQuery = useQuery<PortalContactConfiguration>({
    queryKey: ['portal-contact-configuration', scope.mode, scope.customerId],
    enabled: Boolean(scope.overview ?? overview),
    queryFn: () => portalGetContactConfiguration(scope),
    // Rascunho local nao pode ser descartado por refetch de fundo; o componente
    // so sincroniza quando nao ha edicao suja (padrao PortalProfile).
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const saveConfiguration = useMutation({
    mutationFn: (contacts: readonly PortalContactDraft[]) =>
      portalSaveContactConfiguration(contacts, scope),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal-contact-configuration'] })
      await queryClient.invalidateQueries({ queryKey: ['portal-profile'] })
      await refreshOverview()
    },
  })

  return {
    ...contactConfigQuery,
    saveConfiguration,
    errorMessage: (error: unknown, fallback = 'Erro ao salvar contatos.') =>
      portalErrorMessage(error, fallback),
  }
}
