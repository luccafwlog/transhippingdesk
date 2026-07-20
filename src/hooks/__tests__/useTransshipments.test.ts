// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useSetBlDisposition } from '../useTransshipments'

const { setBlCod, setBlTransshipment } = vi.hoisted(() => ({
  setBlCod: vi.fn(),
  setBlTransshipment: vi.fn(),
}))

vi.mock('../../services/transshipments', () => ({
  setBlCod,
  setBlTransshipment,
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, invalidateQueries }
}

describe('useSetBlDisposition', () => {
  it('invalida o status do Portal do B/L mutado apos COD', async () => {
    setBlCod.mockResolvedValue(undefined)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useSetBlDisposition(7), { wrapper: Wrapper })

    result.current.setCod.mutate({ blId: 'BL1', omissionId: 1, changedBy: 'user-1' })

    await waitFor(() => expect(result.current.setCod.isSuccess).toBe(true))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bl-portal-status', 'BL1'] })
  })

  it('invalida o status do Portal do B/L mutado apos restaurar transbordo', async () => {
    setBlTransshipment.mockResolvedValue(undefined)
    const { Wrapper, invalidateQueries } = createWrapper()
    const { result } = renderHook(() => useSetBlDisposition(7), { wrapper: Wrapper })

    result.current.setTransshipment.mutate({ blId: 'BL2', omissionId: 2, changedBy: 'user-1' })

    await waitFor(() => expect(result.current.setTransshipment.isSuccess).toBe(true))
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['bl-portal-status', 'BL2'] })
  })
})
