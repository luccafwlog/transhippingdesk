import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabasePortal: { rpc },
}))

import { normalizePortalOperationRows, portalListOperationBls } from '../portalOperation'

beforeEach(() => {
  rpc.mockReset()
})

describe('portalOperation', () => {
  it('normaliza B/Ls operacionais e converte numeros vindos do RPC', () => {
    const rows = normalizePortalOperationRows([
      {
        bl_id: 'BL001',
        ce_mercante: '123456789012345',
        pol: 'CNSHA',
        pod: 'BRVIX',
        voyage_id: '10',
        voyage_number: '001W',
        vessel_name: 'NAVIO TESTE',
        container_count: '2',
        containers_in_demurrage: '1',
        containers_returned: '1',
        containers: [
          {
            id: '7',
            container_number: 'ABCD1234567',
            type: '40GP',
            discharge_date: '2026-06-01',
            return_date: '2026-06-20',
            usage_days: '19',
            free_time_days: '21',
            demurrage_days: '0',
            status: 'devolvido',
          },
        ],
      },
    ])

    expect(rows).toEqual([
      {
        bl_id: 'BL001',
        ce_mercante: '123456789012345',
        pol: 'CNSHA',
        pod: 'BRVIX',
        voyage_id: 10,
        voyage_number: '001W',
        vessel_name: 'NAVIO TESTE',
        container_count: 2,
        containers_in_demurrage: 1,
        containers_returned: 1,
        containers: [
          {
            id: 7,
            container_number: 'ABCD1234567',
            type: '40GP',
            discharge_date: '2026-06-01',
            return_date: '2026-06-20',
            usage_days: 19,
            free_time_days: 21,
            demurrage_days: 0,
            status: 'devolvido',
          },
        ],
      },
    ])
  })

  it('usa defaults quando o RPC traz containers e contadores nulos', () => {
    const rows = normalizePortalOperationRows([
      {
        bl_id: 'BL002',
        ce_mercante: null,
        pol: null,
        pod: null,
        voyage_id: null,
        voyage_number: null,
        vessel_name: null,
        container_count: null,
        containers_in_demurrage: null,
        containers_returned: null,
        containers: null,
      },
    ])

    expect(rows[0]).toMatchObject({
      bl_id: 'BL002',
      ce_mercante: null,
      container_count: 0,
      containers_in_demurrage: 0,
      containers_returned: 0,
      containers: [],
    })
  })

  it('chama portal_list_operation_bls pelo cliente Supabase do portal', async () => {
    rpc.mockResolvedValueOnce({ data: [{ bl_id: 'BL001', containers: [] }], error: null })

    const rows = await portalListOperationBls()

    expect(rpc).toHaveBeenCalledWith('portal_list_operation_bls')
    expect(rows[0]?.bl_id).toBe('BL001')
  })

  it('propaga erro retornado pelo RPC', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error('RPC falhou') })

    await expect(portalListOperationBls()).rejects.toThrow('RPC falhou')
  })
})
