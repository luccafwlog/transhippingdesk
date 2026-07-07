import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { reportCaughtException } from './telemetry'

function reportQueryError(error: unknown, meta: Record<string, unknown>) {
  reportCaughtException(error, 'TanStack Query', meta)
}

export function createAppQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        reportQueryError(error, { queryKey: JSON.stringify(query.queryKey) })
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        reportQueryError(error, {
          mutationKey: mutation.options.mutationKey ? JSON.stringify(mutation.options.mutationKey) : undefined,
        })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}
