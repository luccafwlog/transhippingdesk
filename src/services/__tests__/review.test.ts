import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConcurrentEditError, saveBlReview } from '../review'

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}))

describe('review service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('rejeita valor numerico invalido antes de chamar o RPC', async () => {
    await expect(
      saveBlReview({
        blId: 'BL001',
        original: {
          shipper: 'SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 100,
          total_cbm: 20,
          notes: null,
        },
        values: {
          shipper: 'SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 'abc' as unknown as number,
          total_cbm: 20,
          notes: null,
        },
        customerId: null,
        previousCustomerId: null,
        changedBy: 'user-1',
        justification: 'Teste',
        expectedUpdatedAt: '2026-04-13T00:00:00.000Z',
      }),
    ).rejects.toThrow('Valor invalido para total_weight_kg')

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('mapeia conflito concorrente para ConcurrentEditError', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'conflito concorrente' },
    })

    await expect(
      saveBlReview({
        blId: 'BL001',
        original: {
          shipper: 'SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 100,
          total_cbm: 20,
          notes: null,
        },
        values: {
          shipper: 'NOVO SHIPPER',
          consignee: 'CNEE',
          pol: 'CNTAC',
          pod: 'BRVIT',
          total_weight_kg: 100,
          total_cbm: 20,
          notes: null,
        },
        customerId: null,
        previousCustomerId: null,
        changedBy: 'user-1',
        justification: 'Teste',
        expectedUpdatedAt: '2026-04-13T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(ConcurrentEditError)
  })
})
