import { describe, expect, it, vi } from 'vitest'
import { Query, QueryCache } from '@tanstack/react-query'
import { createAppQueryClient } from '../queryClient'
import { reportCaughtException } from '../telemetry'

vi.mock('../telemetry', () => ({
  reportCaughtException: vi.fn(),
}))

describe('createAppQueryClient', () => {
  it('reporta erros globais de query com a queryKey', () => {
    const error = new Error('query falhou')
    const client = createAppQueryClient()
    const query = client.getQueryCache().build(client, {
      queryKey: ['portal-invoices'],
      queryFn: async () => [],
    })

    ;(client.getQueryCache() as QueryCache).config.onError?.(error, query as unknown as Query<unknown, unknown, unknown>)

    expect(reportCaughtException).toHaveBeenCalledWith(error, 'TanStack Query', { queryKey: '["portal-invoices"]' })
  })
})
