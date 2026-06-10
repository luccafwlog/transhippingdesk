import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  buildPix: vi.fn(() => 'pix-payload'),
}))

// billing.ts cria o cliente Supabase no import; as funções testadas aqui são
// puras (não tocam o banco), então mockamos o módulo.
vi.mock('../supabase', () => ({ supabase: { from: supabaseMocks.from, rpc: supabaseMocks.rpc } }))
vi.mock('../../lib/pix', () => ({ buildTransshippingPixPayload: supabaseMocks.buildPix }))

import {
  createInvoiceFromBls,
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
  listInvoicesForExport,
} from '../billing'
import { createConsolidatedInvoice } from '../billingLedger'

beforeEach(() => {
  supabaseMocks.from.mockReset()
  supabaseMocks.rpc.mockReset()
  supabaseMocks.buildPix.mockReset()
  supabaseMocks.buildPix.mockReturnValue('pix-payload')
})

function invoiceFetchQuery(result: unknown) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(result),
      })),
    })),
  }
}

function invoiceUpdateQuery(result: unknown) {
  return {
    update: vi.fn(() => ({
      eq: vi.fn().mockResolvedValue(result),
    })),
  }
}

function invoiceListQuery(range: (from: number, to: number) => unknown) {
  return {
    select: vi.fn(() => ({
      order: vi.fn(() => ({
        range: vi.fn((from: number, to: number) => ({
          overrideTypes: () => range(from, to),
        })),
      })),
    })),
  }
}

describe('isConsolidatedInvoice', () => {
  it('reconhece faturas consolidadas pelo invoice_type', () => {
    expect(isConsolidatedInvoice({ invoice_type: 'consolidated' })).toBe(true)
    expect(isConsolidatedInvoice({ invoice_type: 'individual' })).toBe(false)
    expect(isConsolidatedInvoice({ invoice_type: null })).toBe(false)
    expect(isConsolidatedInvoice({})).toBe(false)
  })
})

describe('getInvoiceBls', () => {
  it('prioriza invoice_bls diretos quando existem', () => {
    const row = {
      invoice_bls: [
        { bl_id: 'CSC1', bl: { pod: 'SSZ', voyage: { voyage_number: 'V1', vessel: { name: 'NAVIO' } } } },
      ],
      invoice_receivable_links: [{ bl_id: 'IGNORADO', bl: null }],
    }
    const bls = getInvoiceBls(row as never)
    expect(bls).toEqual([
      { bl_id: 'CSC1', pod: 'SSZ', voyage_number: 'V1', vessel_name: 'NAVIO' },
    ])
  })

  it('usa invoice_receivable_links quando não há invoice_bls (consolidada)', () => {
    const row = {
      invoice_bls: [],
      invoice_receivable_links: [{ bl_id: 'CSC9', bl: { pod: 'RIO', voyage: null } }],
    }
    const bls = getInvoiceBls(row as never)
    expect(bls).toEqual([
      { bl_id: 'CSC9', pod: 'RIO', voyage_number: null, vessel_name: null },
    ])
  })

  it('descarta entradas sem bl_id', () => {
    const row = {
      invoice_bls: [{ bl_id: '  ', bl: null }, { bl_id: 'OK', bl: null }],
      invoice_receivable_links: [],
    }
    expect(getInvoiceBls(row as never).map((b) => b.bl_id)).toEqual(['OK'])
  })
})

describe('getInvoicePaymentDate', () => {
  it('retorna a data de pagamento mais recente', () => {
    const row = { payments: [{ paid_at: '2026-01-10' }, { paid_at: '2026-03-02' }, { paid_at: '2026-02-01' }] }
    expect(getInvoicePaymentDate(row as never)).toBe('2026-03-02')
  })

  it('retorna null quando não há pagamentos válidos', () => {
    expect(getInvoicePaymentDate({ payments: [] } as never)).toBeNull()
    expect(getInvoicePaymentDate({ payments: [{ paid_at: null }] } as never)).toBeNull()
  })
})

describe('createInvoiceFromBls', () => {
  it('propaga falha ao vincular invoice ao ledger', async () => {
    supabaseMocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'create_invoice_from_bls') {
        return { data: { invoice_id: 123 }, error: null }
      }
      if (name === 'link_invoice_to_ledger') {
        return { data: null, error: new Error('ledger failed') }
      }
      return { data: null, error: null }
    })
    supabaseMocks.from
      .mockReturnValueOnce(invoiceFetchQuery({ data: { invoice_number: 'INV-123', total_brl: 100 }, error: null }))
      .mockReturnValueOnce(invoiceUpdateQuery({ error: null }))

    await expect(createInvoiceFromBls({ blIds: ['BL001'] })).rejects.toThrow('ledger failed')
  })
})

describe('createConsolidatedInvoice', () => {
  it('propaga falha ao persistir payload PIX consolidado', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: { invoice_id: 456, invoice_number: 'INV-456', total_brl: 250 },
      error: null,
    })
    supabaseMocks.from.mockReturnValueOnce(invoiceUpdateQuery({ error: new Error('pix failed') }))

    await expect(createConsolidatedInvoice({ customerId: 10, receivableIds: [1, 2] })).rejects.toThrow('pix failed')
  })
})

describe('listInvoicesForExport', () => {
  it('busca paginas sucessivas para nao depender de um lote gigante', async () => {
    const makeRows = (from: number, length: number) =>
      Array.from({ length }, (_, index) => ({ id: from + index + 1, invoice_number: `INV-${from + index + 1}` }))
    const range = vi.fn(async (from: number) => ({
      data:
        from === 0
          ? makeRows(0, 1000)
          : from === 1000
            ? makeRows(1000, 1000)
            : from === 2000
              ? makeRows(2000, 1)
              : [],
      error: null,
      count: 2001,
    }))
    supabaseMocks.from.mockReturnValue(invoiceListQuery(range))

    const rows = await listInvoicesForExport({
      search: '',
      customerId: '',
      status: '',
      invoiceType: '',
      blSearch: '',
      voyageSearch: '',
      pod: '',
      dateFrom: '',
      dateTo: '',
      paidFrom: '',
      paidTo: '',
      page: 1,
      pageSize: 20,
    })

    expect(rows).toHaveLength(2001)
    expect(range).toHaveBeenCalledTimes(3)
    expect(range).toHaveBeenNthCalledWith(1, 0, 999)
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999)
    expect(range).toHaveBeenNthCalledWith(3, 2000, 2999)
  })
})
