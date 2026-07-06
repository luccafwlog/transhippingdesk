// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usePageFilters } from '../usePageFilters'

describe('usePageFilters', () => {
  it('resets page when a non-page filter changes', () => {
    const { result } = renderHook(() => usePageFilters({ search: '', page: 3, pageSize: 20 }))

    act(() => result.current.updateFilter('search', 'abc'))

    expect(result.current.filters).toEqual({ search: 'abc', page: 1, pageSize: 20 })
  })

  it('resets page when pageSize changes and keeps direct page changes', () => {
    const { result } = renderHook(() => usePageFilters({ search: '', page: 3, pageSize: 20 }))

    act(() => result.current.updateFilter('pageSize', 50))
    expect(result.current.filters.page).toBe(1)
    expect(result.current.filters.pageSize).toBe(50)

    act(() => result.current.updateFilter('page', 2))
    expect(result.current.filters.page).toBe(2)
  })
})
