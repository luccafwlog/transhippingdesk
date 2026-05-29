import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmUnifiedPixReconciliation, matchUnifiedPixTransactions } from '../reconciliacao'
import type { UnifiedPixMatch } from '../reconciliacao'

const { mockFrom, mockInvoiceUpdate, mockReconcileByTxid, mockRegisterLegacy } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockReconcileByTxid: vi.fn(),
  mockRegisterLegacy: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
  },
}))

vi.mock('../billing', () => ({
  registerInvoicePayment: mockRegisterLegacy,
}))

vi.mock('../billingLedger', () => ({
  reconcileInvoicePaymentByTxid: mockReconcileByTxid,
}))

function createSelectBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return builder
}

function installFromMock(input: { localInvoices?: unknown[]; demurrageInvoices?: unknown[] }) {
  const localInvoices = input.localInvoices ?? []
  const demurrageInvoices = input.demurrageInvoices ?? []
  const invoiceUpdateBuilder = {
    eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
  }

  mockInvoiceUpdate.mockReturnValue(invoiceUpdateBuilder)
  mockFrom.mockImplementation((table: string) => {
    if (table === 'invoices') {
      return {
        select: vi.fn(() => createSelectBuilder({ data: localInvoices, error: null })),
        update: mockInvoiceUpdate,
      }
    }
    if (table === 'demurrage_invoices') {
      return {
        select: vi.fn(() => createSelectBuilder({ data: demurrageInvoices, error: null })),
        update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) })),
      }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

describe('reconciliacao PIX unificada', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockInvoiceUpdate.mockReset()
    mockReconcileByTxid.mockReset()
    mockRegisterLegacy.mockReset()
  })

  it('nao casa fatura local por CNPJ e valor quando o TXID nao corresponde ao numero da invoice', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          status: 'issued',
          pix_txid: null,
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      {
        txid: 'OUTRO-TXID',
        cnpj: '12.345.678/0001-95',
        date: '2026-05-28',
        amount: 100,
      },
    ])

    expect(matches).toEqual([])
  })

  it('confirma fatura local pelo RPC reconcile_invoice_payment_by_txid', async () => {
    installFromMock({})
    mockReconcileByTxid.mockResolvedValue({ matched: true, invoice_id: 10, settled: true })
    mockRegisterLegacy.mockResolvedValue({ invoice_id: 10 })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: {
          txid: 'INV-001',
          cnpj: '12.345.678/0001-95',
          date: '2026-05-28',
          amount: 100,
        },
        source: 'local',
        invoiceId: 10,
        docNumber: 'INV-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    const result = await confirmUnifiedPixReconciliation(matches)

    expect(mockReconcileByTxid).toHaveBeenCalledWith({
      txid: 'INV-001',
      amountBrl: 100,
      paidAt: '2026-05-28',
    })
    expect(mockRegisterLegacy).not.toHaveBeenCalled()
    expect(mockInvoiceUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ local: 1, demurrage: 0 })
  })
})
