import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calculateBlLocalCharges,
  listBlLocalChargeLines,
  listLocalChargePendencies,
  listLocalChargeTables,
} from '../localCharges'

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}))

function createBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    in: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

describe('localCharges service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockFrom.mockReset()
  })

  it('normaliza retorno do calculate_bl_local_charges', async () => {
    mockRpc.mockResolvedValue({
      data: {
        bl_id: 'CSC001',
        status: 'calculated',
        table_id: 12,
        line_count: 5,
        total_brl: '4512.34',
        total_usd: '0',
        review_required: false,
        exempt: false,
        reason: '',
      },
      error: null,
    })

    const result = await calculateBlLocalCharges('CSC001', { actorId: 'user-id', recalculate: true })

    expect(result).toEqual({
      bl_id: 'CSC001',
      status: 'calculated',
      table_id: 12,
      line_count: 5,
      total_brl: 4512.34,
      total_usd: 0,
      review_required: false,
      exempt: false,
      reason: '',
    })
    expect(mockRpc).toHaveBeenCalledWith('calculate_bl_local_charges', {
      p_bl_id: 'CSC001',
      p_actor: 'user-id',
      p_recalculate: true,
    })
  })

  it('retorna linhas de taxa via list_bl_local_charge_lines', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 1,
          bl_id: 'CSC001',
          charge_name: 'THD',
          source: 'auto',
          status: 'calculated',
          quantity: 2,
          currency: 'BRL',
          unit_value_brl: 1420,
          total_value_brl: 2840,
        },
      ],
      error: null,
    })

    const rows = await listBlLocalChargeLines('CSC001')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.charge_name).toBe('THD')
    expect(mockRpc).toHaveBeenCalledWith('list_bl_local_charge_lines', {
      p_bl_id: 'CSC001',
    })
  })

  it('lista tabelas de taxas com itens ordenados', async () => {
    const tableBuilder = createBuilder({
      data: [
        {
          id: 1,
          name: 'Tabela CNTR BRVIT',
          charge_table_items: [
            { id: 20, name: 'ISPS', sort_order: 20 },
            { id: 10, name: 'THD', sort_order: 10 },
          ],
        },
      ],
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'charge_tables') {
        return {
          select: vi.fn(() => tableBuilder),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows = await listLocalChargeTables({ cargoMode: 'container', pod: 'BRVIT' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.charge_table_items[0]?.name).toBe('THD')
  })

  it('lista pendencias de taxas locais', async () => {
    const pendencyBuilder = createBuilder({
      data: [{ id: 'BL1', charge_status: 'review_required' }],
      error: null,
    })

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bls') {
        return {
          select: vi.fn(() => pendencyBuilder),
        }
      }
      throw new Error(`Tabela nao mockada: ${table}`)
    })

    const rows = await listLocalChargePendencies(50)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('BL1')
  })
})

