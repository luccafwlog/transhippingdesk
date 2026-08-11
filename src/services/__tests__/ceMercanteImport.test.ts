import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importCeMercanteEdi, importCeMercanteRows, parseCeMercanteBuffer, partitionRowsByVoyage, type CeMercanteRow } from '../ceMercanteImport'
import { jsonToBuffer } from './testWorkbook'

const { mockFrom, mockRpc, mockMaybeAutoBillAfterCeMercante } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockMaybeAutoBillAfterCeMercante: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

vi.mock('../reviewBillingAutomation', () => ({
  maybeAutoBillAfterCeMercante: mockMaybeAutoBillAfterCeMercante,
}))

describe('ceMercanteImport', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    mockMaybeAutoBillAfterCeMercante.mockReset()
    mockMaybeAutoBillAfterCeMercante.mockResolvedValue(null)
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
    expect(mockMaybeAutoBillAfterCeMercante).toHaveBeenCalledWith('BL001', null)
  })

  it('grava CE de um B/L existente somente em granite_bls', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: async () => ({ data: { id: 'GR1' }, error: null }),
        })),
      })),
    }))
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'granite_bls') throw new Error(`Tabela nao mockada: ${table}`)
      return {
        select: () => ({
          in: async () => ({ data: [{ id: 'GR1' }], error: null }),
        }),
        update,
      }
    })

    const result = await importCeMercanteRows(
      [{ rowNumber: 2, bl_id: 'GR1', ce_mercante: '122605051526081' }],
      { changedBy: 'user-1', target: 'granite' },
    )

    expect(result).toMatchObject({ processed: 1, updated: 1, errorCount: 0 })
    expect(update).toHaveBeenCalledWith({ ce_mercante: '122605051526081' })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(mockMaybeAutoBillAfterCeMercante).toHaveBeenCalledWith('GR1', 'user-1', 'granite')
  })

  it('separa BLs de outra viagem sem antecipar o erro de BL inexistente', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { id: 'BL001', voyage_id: 7 },
            { id: 'BL002', voyage_id: 8 },
          ],
          error: null,
        }),
      }),
    }))
    const rows: CeMercanteRow[] = [
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { rowNumber: 3, bl_id: 'BL002', ce_mercante: '122605051526082' },
      { rowNumber: 4, bl_id: 'BL999', ce_mercante: '122605051526083' },
    ]

    await expect(partitionRowsByVoyage(rows, 7)).resolves.toEqual({
      rows: [rows[0], rows[2]],
      blocked: [{ row: 3, bl_id: 'BL002', message: 'B/L BL002 pertence a outra viagem' }],
    })
  })

  it('nao dispara automacao quando a aplicacao do CE falha', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        in: async () => ({ data: [{ id: 'BL001' }], error: null }),
      }),
    }))
    mockRpc.mockResolvedValue({ data: null, error: { message: 'CE invalido' } })

    const result = await importCeMercanteRows([
      { rowNumber: 2, bl_id: 'BL001', ce_mercante: '122605051526081' },
    ])

    expect(result.errorCount).toBe(1)
    expect(mockMaybeAutoBillAfterCeMercante).not.toHaveBeenCalled()
  })

  it('dispara automacao para cada BL apos importar CE por EDI', async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, batch_id: 10, processed: 2, inserted: 2, overwritten: 0, unchanged: 0 },
      error: null,
    })

    const result = await importCeMercanteEdi([
      { lineNumber: 1, bl_id: 'BL001', ce_mercante: '122605051526081' },
      { lineNumber: 2, bl_id: 'BL002', ce_mercante: '122605051526082' },
    ], { changedBy: 'user-1' })

    expect(result).toMatchObject({ ok: true, batchId: 10, processed: 2 })
    expect(mockMaybeAutoBillAfterCeMercante).toHaveBeenCalledWith('BL001', 'user-1')
    expect(mockMaybeAutoBillAfterCeMercante).toHaveBeenCalledWith('BL002', 'user-1')
  })
})
