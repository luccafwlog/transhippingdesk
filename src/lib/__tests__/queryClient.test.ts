import { describe, expect, it, vi } from 'vitest'
import { Query, QueryCache } from '@tanstack/react-query'
import { createAppQueryClient } from '../queryClient'
import { reportCaughtException } from '../telemetry'

vi.mock('../telemetry', () => ({
  reportCaughtException: vi.fn(),
}))

describe('createAppQueryClient', () => {
  it('reporta erros de query enriquecidos com tags semânticas e diagnósticos didáticos', () => {
    const error = new Error('query falhou')
    const client = createAppQueryClient()
    const query = client.getQueryCache().build(client, {
      queryKey: ['portal-invoices'],
      queryFn: async () => [],
    })

    ;(client.getQueryCache() as QueryCache).config.onError?.(error, query as unknown as Query<unknown, unknown, unknown>)

    expect(reportCaughtException).toHaveBeenCalledWith(
      error,
      'TanStack Query',
      expect.objectContaining({
        queryKey: '["portal-invoices"]',
        resumo_didatico: expect.stringContaining('Portal do Cliente'),
        diagnostico: 'query falhou',
      }),
      expect.objectContaining({
        modulo: 'Portal do Cliente',
        tela: 'Faturas do Cliente',
        tarefa: 'Carregar faturas disponíveis no portal',
        categoria_falha: 'Erro Não Tratado',
      }),
    )
  })

  it('reporta erros de conciliação PIX com contexto exato de negócio', () => {
    const error = Object.assign(new Error('permission denied for table'), { code: '42501' })
    const client = createAppQueryClient()
    const query = client.getQueryCache().build(client, {
      queryKey: ['pix-reconciliation-exceptions'],
      queryFn: async () => [],
    })

    ;(client.getQueryCache() as QueryCache).config.onError?.(error, query as unknown as Query<unknown, unknown, unknown>)

    expect(reportCaughtException).toHaveBeenCalledWith(
      error,
      'TanStack Query',
      expect.objectContaining({
        queryKey: '["pix-reconciliation-exceptions"]',
      }),
      expect.objectContaining({
        modulo: 'Financeiro',
        tela: 'Conciliação PIX',
        tarefa: 'Listar pendências PIX',
        categoria_falha: 'Segurança / Permissão',
        codigo_erro: '42501',
      }),
    )
  })

  it('reporta erros de mutation com tags didáticas', () => {
    const error = new Error('falha de mutacao')
    const client = createAppQueryClient()
    const mutation = client.getMutationCache().build(client, {
      mutationKey: ['demurrage-invoices'],
      mutationFn: async () => {},
    })

    const cacheWithConfig = client.getMutationCache() as unknown as {
      config: {
        onError?: (error: Error, variables: unknown, onMutateResult: unknown, mutation: unknown, context: unknown) => void
      }
    }
    cacheWithConfig.config.onError?.(
      error,
      undefined,
      undefined,
      mutation,
      undefined,
    )

    expect(reportCaughtException).toHaveBeenCalledWith(
      error,
      'TanStack Query',
      expect.objectContaining({
        mutationKey: '["demurrage-invoices"]',
      }),
      expect.objectContaining({
        modulo: 'Demurrage',
        tela: 'Faturas Demurrage',
        categoria_falha: 'Erro Não Tratado',
      }),
    )
  })
})
