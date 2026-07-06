import { useState } from 'react'

export const PAGE_SIZES = [20, 50, 100] as const

type PageFilterState = {
  page: number
  pageSize: number
}

export function usePageFilters<TFilters extends PageFilterState>(initialFilters: TFilters) {
  const [filters, setFilters] = useState(initialFilters)

  function updateFilter<K extends keyof TFilters>(key: K, value: TFilters[K]) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? Number(value) : 1,
    }))
  }

  return { filters, setFilters, updateFilter }
}
