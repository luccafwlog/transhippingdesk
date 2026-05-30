import { describe, expect, it, vi } from 'vitest'

// billing.ts cria o cliente Supabase no import; as funções testadas aqui são
// puras (não tocam o banco), então mockamos o módulo.
vi.mock('../supabase', () => ({ supabase: {} }))
vi.mock('../../lib/pix', () => ({ buildTransshippingPixPayload: () => '' }))

import {
  getInvoiceBls,
  getInvoicePaymentDate,
  isConsolidatedInvoice,
} from '../billing'

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
