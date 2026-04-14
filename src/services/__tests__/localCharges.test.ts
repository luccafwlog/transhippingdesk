import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateBlLocalCharges, listBlLocalChargeLines } from '../localCharges'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}))

describe('localCharges service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
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
})

