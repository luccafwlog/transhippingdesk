// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMock, retryMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  retryMock: vi.fn(),
}))

vi.mock('../../services/importEffects', () => ({
  listImportEffects: listMock,
  retryImportEffect: retryMock,
}))

import { useImportEffects } from '../useImportEffects'

const effect = {
  id: 17,
  source_action_id: 'action-17',
  effect_kind: 'local_billing' as const,
  entity_id: 'BL-17',
  status: 'blocked' as const,
  attempts: 1,
  created_at: '2026-09-07T12:00:00Z',
  created_by: 'user-17',
  source_revision: 1,
  source_snapshot: {},
  depends_on_effect_id: null,
  next_attempt_at: '2026-09-07T12:00:00Z',
  lease_until: null,
  leased_by: null,
  last_error_code: 'effect_failed',
  last_error_message: 'Tabela de taxas indisponível.',
  result: null,
  superseded_by_effect_id: null,
  updated_at: '2026-09-07T12:00:00Z',
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useImportEffects', () => {
  beforeEach(() => {
    listMock.mockReset()
    retryMock.mockReset()
  })

  it('reabre a consulta por entidade e encaminha retry para a mutation auditada', async () => {
    listMock.mockResolvedValue([effect])
    retryMock.mockResolvedValue({ effect: { ...effect, status: 'retry_wait' }, idempotent: false })

    const { result } = renderHook(() => useImportEffects('BL-17', 25), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.data).toEqual([effect]))
    expect(listMock).toHaveBeenCalledWith({ entityId: 'BL-17', limit: 25 })

    await act(async () => {
      await result.current.retryMutation.mutateAsync({ effectId: 17, justification: 'corrigir cadastro' })
    })

    expect(retryMock).toHaveBeenCalledWith(17, 'corrigir cadastro')
  })

  it('não consulta quando a entidade não está disponível', () => {
    const { result } = renderHook(() => useImportEffects(null), { wrapper: createWrapper() })

    expect(result.current.fetchStatus).toBe('idle')
    expect(listMock).not.toHaveBeenCalled()
  })
})
