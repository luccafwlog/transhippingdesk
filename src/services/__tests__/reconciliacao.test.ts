import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmUnifiedPixReconciliation, matchUnifiedPixTransactions } from '../reconciliacao'
import type { UnifiedPixMatch } from '../reconciliacao'

const { mockFrom, mockRpc, mockInvoiceUpdate, mockDemurrageUpdate } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockInvoiceUpdate: vi.fn(),
  mockDemurrageUpdate: vi.fn(),
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
}))

function createSelectBuilder(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    overrideTypes: vi.fn(() => builder),
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
  mockDemurrageUpdate.mockReturnValue({ eq: vi.fn() })
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
        update: mockDemurrageUpdate,
      }
    }
    throw new Error(`Tabela nao mockada: ${table}`)
  })
}

const demurrageOkItems = [
  { source: 'demurrage', invoice_id: 20, doc_number: 'DEM-001', status: 'ok' },
  { source: 'demurrage', invoice_id: 21, doc_number: 'DEM-002', status: 'ok' },
]

describe('reconciliacao PIX unificada', () => {
  beforeEach(() => {
    mockFrom.mockReset()
    mockRpc.mockReset()
    mockInvoiceUpdate.mockReset()
    mockDemurrageUpdate.mockReset()
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

  it('marca como ambiguo quando o mesmo TXID existe em fatura local e demurrage', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: null,
          customer: { name: 'Cliente Local', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
      demurrageInvoices: [
        {
          id: 20,
          doc_number: 'INV-001',
          frozen_total_brl: 100,
          pix_txid: null,
          customer: { name: 'Cliente Demurrage', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ docNumber: 'INV-001', ambiguous: true })
  })

  it('marca demurrage com valor divergente como ambiguo antes da confirmacao', async () => {
    installFromMock({
      demurrageInvoices: [
        {
          id: 20,
          doc_number: 'DEM-001',
          frozen_total_brl: 100,
          pix_txid: null,
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 90 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'demurrage', ambiguous: true })
  })

  it('marca fatura local com valor a menor como ambiguo (PIX nao admite parcial)', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: null,
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 40 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'local', ambiguous: true })
  })

  it('ignora (marca ambiguo) o mesmo TXID repetido no mesmo extrato', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: null,
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-29', amount: 100 },
    ])

    expect(matches).toHaveLength(2)
    expect(matches[0]).toMatchObject({ ambiguous: false })
    expect(matches[1]).toMatchObject({ ambiguous: true })
  })

  it('marca fatura local com valor acima do saldo como ambiguo antes da confirmacao', async () => {
    installFromMock({
      localInvoices: [
        {
          id: 10,
          invoice_number: 'INV-001',
          total_brl: 100,
          balance_brl: 100,
          pix_txid: null,
          customer: { name: 'Cliente Alfa', cnpj_cpf: '12.345.678/0001-95' },
        },
      ],
    })

    const matches = await matchUnifiedPixTransactions([
      { txid: 'INV-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 120 },
    ])

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ source: 'local', ambiguous: true })
  })

  it('confirma fatura local pela RPC unificada', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({
      data: { local: 1, demurrage: 0, items: [{ source: 'local', invoice_id: 10, doc_number: 'INV-001', status: 'ok' }] },
      error: null,
    })
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

    expect(mockRpc).toHaveBeenCalledWith('confirm_unified_pix_matches', {
      p_matches: [
        {
          source: 'local',
          invoice_id: 10,
          doc_number: 'INV-001',
          txid: 'INV-001',
          amount: 100,
          expected_amount: 100,
          paid_at: '2026-05-28',
        },
      ],
    })
    expect(mockInvoiceUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({
      local: 1,
      demurrage: 0,
      items: [{ source: 'local', invoice_id: 10, doc_number: 'INV-001', status: 'ok' }],
    })
  })

  it('propaga erro do banco quando valor de demurrage diverge', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: null, error: new Error('Valor divergente para demurrage DEM-001.') })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: {
          txid: 'DEM-001',
          cnpj: '12.345.678/0001-95',
          date: '2026-05-28',
          amount: 90,
        },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/valor|diverg/i)
    expect(mockDemurrageUpdate).not.toHaveBeenCalled()
  })

  it('propaga erro do banco ao confirmar conciliacao de demurrage', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: null, error: new Error('db down') })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: {
          txid: 'DEM-001',
          cnpj: '12.345.678/0001-95',
          date: '2026-05-28',
          amount: 100,
        },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow('db down')
  })

  it('concilia demurrage em lote com uma unica chamada RPC', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: { local: 0, demurrage: 2, items: demurrageOkItems }, error: null })
    const base = {
      source: 'demurrage' as const,
      customerName: 'Cliente Alfa',
      customerCnpj: '12345678000195',
      ambiguous: false,
      matchType: 'txid' as const,
    }
    const matches: UnifiedPixMatch[] = [
      {
        ...base,
        transaction: { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
        invoiceId: 20,
        docNumber: 'DEM-001',
        amount: 100,
      },
      {
        ...base,
        transaction: { txid: 'DEM-002', cnpj: '12.345.678/0001-95', date: '2026-05-29', amount: 50 },
        invoiceId: 21,
        docNumber: 'DEM-002',
        amount: 50,
      },
    ]

    const result = await confirmUnifiedPixReconciliation(matches)

    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('confirm_unified_pix_matches', {
      p_matches: [
        {
          source: 'demurrage',
          invoice_id: 20,
          doc_number: 'DEM-001',
          txid: 'DEM-001',
          amount: 100,
          expected_amount: 100,
          paid_at: '2026-05-28',
        },
        {
          source: 'demurrage',
          invoice_id: 21,
          doc_number: 'DEM-002',
          txid: 'DEM-002',
          amount: 50,
          expected_amount: 50,
          paid_at: '2026-05-29',
        },
      ],
    })
    expect(mockDemurrageUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({ local: 0, demurrage: 2, items: demurrageOkItems })
  })

  it('rejeita conciliacao quando a data do extrato nao foi parseada', async () => {
    installFromMock({})
    const matches: UnifiedPixMatch[] = [
      {
        transaction: { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '', amount: 100 },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/data/i)
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('propaga divergencia quando a RPC unificada rejeita o lote', async () => {
    installFromMock({})
    mockRpc.mockResolvedValue({ data: null, error: new Error('Conciliacao de demurrage atualizou 1 de 2 faturas.') })
    const matches: UnifiedPixMatch[] = [
      {
        transaction: { txid: 'DEM-001', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 100 },
        source: 'demurrage',
        invoiceId: 20,
        docNumber: 'DEM-001',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 100,
        ambiguous: false,
        matchType: 'txid',
      },
      {
        transaction: { txid: 'DEM-002', cnpj: '12.345.678/0001-95', date: '2026-05-28', amount: 50 },
        source: 'demurrage',
        invoiceId: 21,
        docNumber: 'DEM-002',
        customerName: 'Cliente Alfa',
        customerCnpj: '12345678000195',
        amount: 50,
        ambiguous: false,
        matchType: 'txid',
      },
    ]

    await expect(confirmUnifiedPixReconciliation(matches)).rejects.toThrow(/atualizou 1 de 2/)
  })
})
