import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAppSettings, setCommunicationsEnabled } from '../services/appSettings'
import { queryKeys } from '../services/queryKeys'

export function useAppSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.appSettings(),
    queryFn: fetchAppSettings,
    enabled,
  })
}

export function useSetCommunicationsEnabled() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (enabled: boolean) => setCommunicationsEnabled(enabled),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() })
    },
  })
}
