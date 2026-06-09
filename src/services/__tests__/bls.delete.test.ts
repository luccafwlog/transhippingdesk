import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkBlDependencies, deleteBls } from '../bls'

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock('../supabase', () => ({ supabase: { from: mockFrom } }))

beforeEach(() => {
  mockFrom.mockReset()
})

function selectInResult(result: { data: unknown[]; error: unknown }) {
  return { select: () => ({ in: () => Promise.resolve(result) }) }
}

const EMPTY_TABLES = ['invoices', 'invoice_bls', 'invoice_receivable_links', 'bl_receivables', 'demurrage_invoices']

describe('checkBlDependencies', () => {
  it('bloqueia BL faturado e libera o restante', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'invoices') return selectInResult({ data: [{ bl_id: 'BL1' }], error: null })
      if (EMPTY_TABLES.includes(table)) return selectInResult({ data: [], error: null })
      throw new Error(`tabela nao mockada: ${table}`)
    })

    const report = await checkBlDependencies(['BL1', 'BL2'])
    expect(report.deletableIds).toEqual(['BL2'])
    expect(report.blockedIds[0].id).toBe('BL1')
    expect(report.blockedIds[0].reasons[0]).toMatch(/fatura/)
  })

  it('bloqueia BL com fatura de demurrage', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'demurrage_invoices') return selectInResult({ data: [{ bl_id: 'BL9' }], error: null })
      if (EMPTY_TABLES.includes(table)) return selectInResult({ data: [], error: null })
      throw new Error(`tabela nao mockada: ${table}`)
    })

    const report = await checkBlDependencies(['BL9'])
    expect(report.deletableIds).toEqual([])
    expect(report.blockedIds[0].reasons[0]).toMatch(/demurrage/)
  })
})

describe('deleteBls', () => {
  it('apaga veiculos antes dos BLs', async () => {
    const order: string[] = []
    const vehiclesIn = vi.fn(() => { order.push('vehicles'); return Promise.resolve({ error: null }) })
    const blsIn = vi.fn(() => { order.push('bls'); return Promise.resolve({ error: null }) })
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') return { delete: () => ({ in: vehiclesIn }) }
      if (table === 'bls') return { delete: () => ({ in: blsIn }) }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await deleteBls(['BL1'])

    expect(order).toEqual(['vehicles', 'bls'])
    expect(vehiclesIn).toHaveBeenCalledWith('bl_id', ['BL1'])
    expect(blsIn).toHaveBeenCalledWith('id', ['BL1'])
  })

  it('propaga erro do banco', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'vehicles') return { delete: () => ({ in: () => Promise.resolve({ error: new Error('db down') }) }) }
      throw new Error(`tabela nao mockada: ${table}`)
    })

    await expect(deleteBls(['BL1'])).rejects.toThrow('db down')
  })
})
