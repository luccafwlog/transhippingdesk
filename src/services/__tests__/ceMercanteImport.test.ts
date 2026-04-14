import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCeMercanteRows, parseCeMercanteBuffer, type CeMercanteRow } from '../ceMercanteImport'
import { jsonToBuffer } from './testWorkbook'

const { mockFrom, mockRpc } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

describe('ceMercanteImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
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

  it('rejeita CE Mercante com numero de digitos incorreto', async () => {
    const buffer = jsonToBuffer([
      { BL: 'BL001', 'CE MERCANTE': '12345' },
      { BL: 'BL002', 'CE MERCANTE': '122605051526081' },
    ])

    const parsed = await parseCeMercanteBuffer(buffer)

    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.bl_id).toBe('BL002')
    expect(parsed.rowErrors).toHaveLength(1)
    expect(parsed.rowErrors[0]?.message).toContain('CE Mercante invalido para o BL BL001')
    expect(parsed.rowErrors[0]?.message).toContain('15 digitos')
  })

  it('atualiza apenas BLs existentes via RPC', async () => {
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
      }
    })

    mockRpc.mockResolvedValue({ data: 'inserted', error: null })

    const rows: CeMercanteRow[] = [
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { rowNumber: 3, bl_id: 'BL999', ce_mercante: '122605051526082' },
    ]

    const result = await importCeMercanteRows(rows)

    expect(result.processed).toBe(2)
    expect(result.updated).toBe(1)
    expect(result.overwritten).toBe(0)
    expect(result.unchanged).toBe(0)
    expect(result.errorCount).toBe(1)
    expect(result.errors[0]?.message).toBe('BL BL999 nao encontrado no sistema.')

    expect(mockRpc).toHaveBeenCalledOnce()
    const [rpcName, rpcArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(rpcName).toBe('apply_ce_mercante_update')
    expect(rpcArgs.p_bl_id).toBe('BL001')
    expect(rpcArgs.p_new_ce).toBe('122605051526081')
  })
})
