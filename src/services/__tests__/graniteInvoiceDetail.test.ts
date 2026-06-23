import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listInvoiceDetails } from '../billing'

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

describe('Granite invoice detail', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
  })

  it('hydrates operational Granite B/L metadata when the generic RPC has no local B/L links', async () => {
    mockRpc.mockResolvedValue({
      data: {
        invoice: {
          id: 50,
          invoice_number: 'INV-GR-50',
          invoice_type: 'granite',
          status: 'issued',
          pix_payload: 'existing',
          total_brl: 100,
        },
        bls: [],
        items: [{ id: 1, description: 'Granito BL GR-001', total_value_brl: 100 }],
        payments: [],
      },
      error: null,
    })

    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: [{
            id: 9,
            granite_bl_id: 'granite-1',
            subtotal_brl: 100,
            granite_bl: {
              bl_number: 'GR-001',
              loading_port: 'CNSHA',
              discharge_port: 'BRSSZ',
              manifest: {
                voyage: { voyage_number: '001', vessel: { name: 'COSCO TEST' } },
              },
            },
          }],
          error: null,
        }).then(resolve),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    mockFrom.mockReturnValue(query)

    const result = await listInvoiceDetails(50)

    expect(mockFrom).toHaveBeenCalledWith('invoice_granite_bls')
    expect(result.bls).toEqual([
      expect.objectContaining({
        bl_id: 'GR-001',
        pol: 'CNSHA',
        pod: 'BRSSZ',
        voyage_number: '001',
        vessel_name: 'COSCO TEST',
        subtotal_brl: 100,
      }),
    ])
  })
})
