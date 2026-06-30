// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAllBls, useBls, useVoyages, type BlFilters } from '../useBls'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../../services/supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

const baseFilters: BlFilters = {
  search: '',
  voyageId: '24',
  cargoMode: 'container',
  pol: '',
  pod: '',
  reviewStatus: '',
  financialStatus: '',
  chargeStatus: '',
  cargoProfile: '',
  page: 1,
  pageSize: 20,
}

function makeBl(id: string, containers: Array<{ is_imo?: boolean; is_oog?: boolean }>) {
  return {
    id,
    voyage_id: 24,
    cargo_mode: 'container',
    bl_containers: containers,
  }
}

function createBlQuery(rows: unknown[]) {
  let selectedRange: [number, number] = [0, rows.length - 1]
  const builder = {
    order: vi.fn(() => builder),
    range: vi.fn((from: number, to: number) => {
      selectedRange = [from, to]
      return builder
    }),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    or: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows.slice(selectedRange[0], selectedRange[1] + 1), error: null }).then(resolve, reject),
  }
  return builder
}

function createVoyageQuery(rows: unknown[]) {
  const builder = {
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve, reject),
  }
  return builder
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('fetchAllBls', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('filtra Standard como BL sem containers IMO ou OOG', async () => {
    const rows = [
      makeBl('BL-STANDARD', [{ is_imo: false, is_oog: false }]),
      makeBl('BL-IMO', [{ is_imo: true, is_oog: false }]),
      makeBl('BL-OOG', [{ is_imo: false, is_oog: true }]),
      makeBl('BL-DUAL', [{ is_imo: true, is_oog: true }]),
    ]

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return { select: vi.fn(() => createBlQuery(rows)) }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const result = await fetchAllBls({ ...baseFilters, cargoProfile: 'standard' })

    expect(result.map((row) => row.id)).toEqual(['BL-STANDARD'])
  })

  it('retorna contagem paginada filtrada quando useBls recebe perfil Standard', async () => {
    const rows = [
      makeBl('BL-STANDARD', [{ is_imo: false, is_oog: false }]),
      makeBl('BL-IMO', [{ is_imo: true, is_oog: false }]),
    ]

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return { select: vi.fn(() => createBlQuery(rows)) }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const { result } = renderHook(() => useBls({ ...baseFilters, cargoProfile: 'standard' }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.data?.count).toBe(1))
    expect(result.current.data?.rows.map((row) => row.id)).toEqual(['BL-STANDARD'])
  })
})

describe('useVoyages', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('busca a cubagem individual dos containers para o EDI Mercante', async () => {
    let voyageSelect = ''

    mockFrom.mockImplementation((table: string) => {
      if (table === 'voyages') {
        return {
          select: vi.fn((select: string) => {
            voyageSelect = select
            return createVoyageQuery([])
          }),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const { result } = renderHook(() => useVoyages(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(voyageSelect.match(/bl_containers\(([^)]*)\)/)?.[1]).toContain('cbm')
  })
})
