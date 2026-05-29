import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createIndividualInvoiceFromReceivable } from '../billingLedger'

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

describe('billingLedger service', () => {
  beforeEach(() => {
    mockRpc.mockReset()
    mockFrom.mockReset()
  })

  it('creates an individual invoice through the receivable RPC', async () => {
    mockRpc.mockResolvedValue({
      data: { invoice_id: 10, invoice_number: 'INV-10', invoice_type: 'individual', receivable_id: 99 },
      error: null,
    })

    const result = await createIndividualInvoiceFromReceivable({
      receivableId: 99,
      dueDate: '2026-06-10',
      notes: 'Emitir individual',
    })

    expect(mockRpc).toHaveBeenCalledWith('create_local_individual_invoice_from_receivable', {
      p_receivable_id: 99,
      p_due_date: '2026-06-10',
      p_notes: 'Emitir individual',
      p_actor: null,
    })
    expect(result).toMatchObject({ invoice_id: 10, invoice_type: 'individual', receivable_id: 99 })
  })
})
