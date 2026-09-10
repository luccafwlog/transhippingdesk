// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCancellableFileRead } from '../useCancellableFileRead'

afterEach(() => vi.useRealTimers())

describe('useCancellableFileRead', () => {
  it('cede a execução ao navegador entre arquivos', async () => {
    vi.useFakeTimers()
    const parser = vi.fn(async (file: File) => ({ name: file.name }))
    const { result } = renderHook(() => useCancellableFileRead(parser))
    const files = [new File(['a'], 'a.csv'), new File(['b'], 'b.csv')]
    let readPromise: Promise<unknown> | undefined

    await act(async () => {
      readPromise = result.current.readFiles(files)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(parser).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await readPromise
    })

    expect(parser).toHaveBeenCalledTimes(2)
    expect(result.current.progress).toMatchObject({ completed: 2, total: 2 })
  })
})
