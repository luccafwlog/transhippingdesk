import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../charges/chargeOperationsService', () => ({
  calculateBlLocalCharges: vi.fn(),
}))

vi.mock('../billing', () => ({
  markBlReadyAndCreateInvoice: vi.fn(),
}))

const { mockLogOperationalEvent } = vi.hoisted(() => ({
  mockLogOperationalEvent: vi.fn(),
}))

vi.mock('../operationalEvents', () => ({
  logOperationalEvent: mockLogOperationalEvent,
}))

const { mockCreateAlert } = vi.hoisted(() => ({ mockCreateAlert: vi.fn() }))
vi.mock('../alerts', () => ({ createAlert: mockCreateAlert }))

const { mockCalculateAndIssueGraniteInvoice } = vi.hoisted(() => ({ mockCalculateAndIssueGraniteInvoice: vi.fn() }))
vi.mock('../graniteBillingWorkflow', () => ({ calculateAndIssueGraniteInvoice: mockCalculateAndIssueGraniteInvoice }))

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

import { markBlReadyAndCreateInvoice } from '../billing'
import { calculateBlLocalCharges } from '../charges/chargeOperationsService'
import { maybeAutoBillAfterCeMercante, tryAutoIssueInvoice } from '../reviewBillingAutomation'

const mockedCalculate = vi.mocked(calculateBlLocalCharges)
const mockedCreateInvoice = vi.mocked(markBlReadyAndCreateInvoice)

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        single: async () => ({
          data: { ce_mercante: '122605051526081', cargo_mode: 'container' },
          error: null,
        }),
      }),
    }),
  }))
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
  mockCalculateAndIssueGraniteInvoice.mockResolvedValue({ lines: [], invoice: { invoice_id: 77 } })
})

describe('tryAutoIssueInvoice', () => {
  it('calcula taxas mesmo sem CE Mercante, mas bloqueia a emissao', async () => {
    mockFrom.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ce_mercante: null, cargo_mode: 'container' },
            error: null,
          }),
        }),
      }),
    }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({
      status: 'blocked',
      reason: 'awaiting_flow',
      message: 'Aguardando cadastro do CE Mercante para emitir a fatura (ADR 0020).',
      calculation: expect.objectContaining({ bl_id: 'BL1' }),
    })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
  })

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
      reason: 'awaiting_flow',
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
      reason: 'no_billable_value',
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

    expect(result).toEqual({ status: 'blocked', reason: 'rpc_error', message: 'ledger failed', unexpected: true })
  })

  it('nao exige CE Mercante para carga solta', async () => {
    mockFrom.mockImplementationOnce(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { ce_mercante: null, cargo_mode: 'carga_solta' },
            error: null,
          }),
        }),
      }),
    }))

    const result = await tryAutoIssueInvoice({ blId: 'BL1', customerId: 99, actorId: 'user-1' })

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 55 } })
    expect(mockedCalculate).toHaveBeenCalledWith('BL1', { actorId: 'user-1', recalculate: true })
  })
})

describe('maybeAutoBillAfterCeMercante', () => {
  function mockBl(overrides: Record<string, unknown>) {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: 'BL1',
              customer_id: 99,
              customer_reconciliation_status: 'matched_document',
              cargo_mode: 'container',
              financial_status: 'pending',
              ce_mercante: '122605051526081',
              ...overrides,
            },
            error: null,
          }),
        }),
      }),
    }))
  }

  it('registra info e nao refatura quando o B/L ja esta faturado', async () => {
    mockBl({ financial_status: 'invoiced' })

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toBeNull()
    expect(mockedCalculate).not.toHaveBeenCalled()
    expect(mockedCreateInvoice).not.toHaveBeenCalled()
    expect(mockLogOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ce_reimport_already_invoiced', entityId: 'BL1', changedBy: 'user-1' }),
    )
  })

  it('registra falha inesperada quando a emissao lanca erro', async () => {
    mockBl({})
    mockedCreateInvoice.mockRejectedValueOnce(new Error('ledger failed'))

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toEqual({ status: 'blocked', reason: 'rpc_error', message: 'ledger failed', unexpected: true })
    expect(mockLogOperationalEvent).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'bl_auto_billing_failed', entityId: 'BL1', changedBy: 'user-1' }),
    )
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_auto_issue_failed', entityType: 'bl', entityId: 'BL1', message: 'ledger failed' }))
  })

  it('alerta quando a emissao falha por ausencia de valor faturavel', async () => {
    mockBl({})
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

    const result = await maybeAutoBillAfterCeMercante('BL1', 'user-1')

    expect(result).toMatchObject({ status: 'blocked', reason: 'no_billable_value', message: 'B/L sem valor faturavel apos recalculo.' })
    expect(result).not.toHaveProperty('unexpected')
    expect(mockCreateAlert).toHaveBeenCalledWith(expect.objectContaining({ type: 'billing_auto_issue_failed', entityId: 'BL1' }))
  })

  it('calcula e emite Granito quando o CE e cadastrado', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: 'GR1', client_id: 99, ce_mercante: '122605051526081', charge_status: 'calculated' },
            error: null,
          }),
        }),
      }),
    }))

    const result = await maybeAutoBillAfterCeMercante('GR1', 'user-1', 'granite')

    expect(result).toEqual({ status: 'invoiced', invoiceResult: { invoice_id: 77 } })
    expect(mockCalculateAndIssueGraniteInvoice).toHaveBeenCalledWith({ blId: 'GR1', customerId: 99, actorId: 'user-1' })
  })

  it('mantem Granito bloqueado sem CE', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: 'GR1', client_id: 99, ce_mercante: null, charge_status: 'calculated' },
            error: null,
          }),
        }),
      }),
    }))

    const result = await maybeAutoBillAfterCeMercante('GR1', 'user-1', 'granite')

    expect(result).toMatchObject({ status: 'blocked', reason: 'awaiting_flow' })
    expect(mockCalculateAndIssueGraniteInvoice).not.toHaveBeenCalled()
  })
})
