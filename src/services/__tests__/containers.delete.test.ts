import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkContainerDependencies, deleteContainers } from '../containers'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))

beforeEach(() => {
  mockFrom.mockReset()
})

function selectInResult(result: { data: unknown[]; error: unknown }) {
  return { select: () => ({ in: () => Promise.resolve(result) }) }
}

describe('checkContainerDependencies', () => {
  it('bloqueia container com calculo de taxa e libera o restante', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'charge_calculations') return selectInResult({ data: [{ container_id: 1 }, { container_id: 1 }], error: null })
      if (table === 'demurrage_invoice_items') return selectInResult({ data: [], error: null })
      throw new Error(`tabela nao mockada: ${table}`)
    })

    const report = await checkContainerDependencies([1, 2])

    expect(report.deletableIds).toEqual([2])
    expect(report.blockedIds).toHaveLength(1)
    expect(report.blockedIds[0].id).toBe(1)
    expect(report.blockedIds[0].reasons[0]).toMatch(/2 calculo/)
  })

  it('bloqueia container com item de demurrage', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'charge_calculations') return selectInResult({ data: [], error: null })
      if (table === 'demurrage_invoice_items') return selectInResult({ data: [{ container_id: 5 }], error: null })
      throw new Error(`tabela nao mockada: ${table}`)
    })

    const report = await checkContainerDependencies([5])
    expect(report.deletableIds).toEqual([])
    expect(report.blockedIds[0].reasons[0]).toMatch(/demurrage/)
  })
})

describe('deleteContainers', () => {
  it('apaga veiculos antes dos containers', async () => {
    const order: string[] = []
    const vehiclesIn = vi.fn(() => { order.push('vehicles'); return Promise.resolve({ error: null }) })
    const containersIn = vi.fn(() => { order.push('bl_containers'); return Promise.resolve({ error: null }) })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') return { delete: () => ({ in: vehiclesIn }) }
      if (table === 'bl_containers') return { delete: () => ({ in: containersIn }) }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await deleteContainers([1, 2])

    expect(order).toEqual(['vehicles', 'bl_containers'])
    expect(vehiclesIn).toHaveBeenCalledWith('container_id', [1, 2])
    expect(containersIn).toHaveBeenCalledWith('id', [1, 2])
  })

  it('propaga erro do banco', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') return { delete: () => ({ in: () => Promise.resolve({ error: new Error('db down') }) }) }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await expect(deleteContainers([1])).rejects.toThrow('db down')
  })
})
