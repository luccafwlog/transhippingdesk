import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../charges/chargeOperationsService', () => ({
  calculateBlLocalCharges: vi.fn(),
}))

vi.mock('../billing', () => ({
  markBlReadyAndCreateInvoice: vi.fn(),
}))

import { markBlReadyAndCreateInvoice } from '../billing'
import { calculateBlLocalCharges } from '../charges/chargeOperationsService'
import { tryAutoIssueInvoice } from '../reviewBillingAutomation'

const mockedCalculate = vi.mocked(calculateBlLocalCharges)
const mockedCreateInvoice = vi.mocked(markBlReadyAndCreateInvoice)

beforeEach(() => {
  vi.clearAllMocks()
  mockedCalculate.mockResolvedValue({
    bl_id: 'BL1',
    status: 'calculated',
    table_id: 1,
    line_count: 1,
    total_brl: 100,
    total_usd: 0,
    review_required: false,
    exempt: false,
    reason: '',
  })
  mockedCreateInvoice.mockResolvedValue({ invoice_id: 55 })
})

describe('tryAutoIssueInvoice', () => {
  it('recalcula, marca pronto e emite a fatura para BL com taxas validas', async () => {
    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 55 } })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).toHaveBeenCalledWith({
      blId: 'BL1',
      customerId: 99,
      actorId: 'user-1',
    })
  })

  it('bloqueia faturamento quando o recalculo ainda retorna pendencia de revisao', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'review_required',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: true,
      exempt: false,
      reason: 'Peso BB ausente.',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'blocked',
      message: 'Peso BB ausente.',
      calculation: {
        bl_id: 'BL1',
        status: 'review_required',
        table_id: 1,
        line_count: 1,
        total_brl: 0,
        total_usd: 0,
        review_required: true,
        exempt: false,
        reason: 'Peso BB ausente.',
      },
    })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('bloqueia faturamento quando nao ha valor faturavel', async () => {
    mockedCalculate.mockResolvedValueOnce({
      bl_id: 'BL1',
      status: 'calculated',
      table_id: 1,
      line_count: 1,
      total_brl: 0,
      total_usd: 0,
      review_required: false,
      exempt: false,
      reason: '',
    })

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'blocked',
      message: 'B/L sem valor faturavel apos recalculo.',
      calculation: {
        bl_id: 'BL1',
        status: 'calculated',
        table_id: 1,
        line_count: 1,
        total_brl: 0,
        total_usd: 0,
        review_required: false,
        exempt: false,
        reason: '',
      },
    })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

  it('retorna bloqueio com a mensagem da falha da invoice sem propagar excecao', async () => {
    mockedCreateInvoice.mockRejectedValueOnce(new Error('ledger failed'))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({ status: 'blocked', message: 'ledger failed' })
  })
})
