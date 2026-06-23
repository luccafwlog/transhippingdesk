// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useRowSelection } from '../useRowSelection'

describe('useRowSelection', () => {
  it('alterna uma chave individual', () => {
    const { result } = renderHook(() => useRowSelection<number>())

    expect(result.current.count).toBe(0)
    act(() => result.current.toggle(1))
    expect(result.current.isSelected(1)).toBe(true)
    expect(result.current.count).toBe(1)

    act(() => result.current.toggle(1))
    expect(result.current.isSelected(1)).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('toggleMany marca todas quando nem todas estao marcadas e desmarca quando todas estao', () => {
    const { result } = renderHook(() => useRowSelection<number>())

    act(() => result.current.toggle(1))
    act(() => result.current.toggleMany([1, 2, 3]))
    expect(result.current.count).toBe(3)

    act(() => result.current.toggleMany([1, 2, 3]))
    expect(result.current.count).toBe(0)
  })

  it('clear esvazia a selecao', () => {
    const { result } = renderHook(() => useRowSelection<string>())

    act(() => result.current.toggleMany(['a', 'b']))
    expect(result.current.count).toBe(2)

    act(() => result.current.clear())
    expect(result.current.count).toBe(0)
  })

  it('limpa a selecao quando o escopo da listagem muda', () => {
    const { result, rerender } = renderHook(
      ({ scope }) => useRowSelection<number>(scope),
      { initialProps: { scope: 'page-1' } },
    )

    act(() => result.current.toggle(10))
    expect(result.current.count).toBe(1)

    rerender({ scope: 'page-2' })
    expect(result.current.count).toBe(0)
  })
})
