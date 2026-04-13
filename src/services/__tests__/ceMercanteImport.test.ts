import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCeMercanteRows, parseCeMercanteBuffer, type CeMercanteRow } from '../ceMercanteImport'
import { jsonToBuffer } from './testWorkbook'

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

describe('ceMercanteImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('parseia a planilha e rejeita BL duplicado', async () => {
    const buffer = jsonToBuffer([
      { BL: 'BL001', 'CE MERCANTE': '122605051526081' },
      { BL: 'BL001', 'CE MERCANTE': '122605051526082' },
    ])

    const parsed = await parseCeMercanteBuffer(buffer)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.ce_mercante).toBe('122605051526081')
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('BL BL001 repetido')
  })

  it('atualiza apenas BLs existentes', async () => {
    const upsertedRows: Array<Record<string, unknown>> = []

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'bls') {
        throw new Error(`Tabela nao mockada: ${table}`)
      }

      return {
        select: () => ({
          in: async (_column: string, values: string[]) => ({
            data: values.filter((value) => value === 'BL001').map((value) => ({ id: value })),
            error: null,
          }),
        }),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          upsertedRows.push(...rows)
          return { error: null }
        },
      }
    })

    const rows: CeMercanteRow[] = [
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { rowNumber: 3, bl_id: 'BL999', ce_mercante: '122605051526082' },
    ]

    const result = await importCeMercanteRows(rows)

    expect(result.processed).toBe(2)
    expect(result.updated).toBe(1)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]?.message).toBe('BL BL999 nao encontrado no sistema.')
    expect(upsertedRows).toEqual([{ id: 'BL001', ce_mercante: '122605051526081' }])
  })
})
