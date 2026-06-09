import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  buildPix: vi.fn(() => 'pix-payload'),
}))

// Testes de caracterização: travam o comportamento ATUAL de billingLedger.ts na
// fronteira do Supabase (mesmo padrão de mock de billingHelpers.test.ts).
vi.mock('../supabase', () => ({ supabase: { from: supabaseMocks.from, rpc: supabaseMocks.rpc } }))
vi.mock('../../lib/pix', () => ({ buildTransshippingPixPayload: supabaseMocks.buildPix }))

import {
  createConsolidatedInvoice,
  listConsolidatableReceivables,
  reconcileInvoicePaymentByTxid,
  registerLedgerInvoicePayment,
} from '../billingLedger'

beforeEach(() => {
  supabaseMocks.from.mockReset()
  supabaseMocks.rpc.mockReset()
  supabaseMocks.buildPix.mockReset()
  supabaseMocks.buildPix.mockReturnValue('pix-payload')
})

function invoiceUpdateQuery(result: unknown) {
  const eq = vi.fn().mockResolvedValue(result)
  const update = vi.fn(() => ({ eq }))
  return { builder: { update }, update, eq }
}

describe('listConsolidatableReceivables', () => {
  it('retorna vazio sem chamar o RPC quando não há customerId (inclusive 0)', async () => {
    expect(await listConsolidatableReceivables({})).toEqual([])
    expect(await listConsolidatableReceivables({ customerId: null })).toEqual([])
    // customerId 0 é falsy e também curto-circuita.
    expect(await listConsolidatableReceivables({ customerId: 0 })).toEqual([])
    expect(supabaseMocks.rpc).not.toHaveBeenCalled()
  })

  it('chama o RPC list_consolidatable_receivables com defaults null', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: [], error: null })

    await listConsolidatableReceivables({ customerId: 9, search: '   ' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_consolidatable_receivables', {
      p_customer_id: 9,
      p_voyage_id: null,
      p_search: null,
    })
  })

  it('repassa voyageId e busca com trim', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: [], error: null })

    await listConsolidatableReceivables({ customerId: 9, voyageId: 4, search: ' CSC1 ' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('list_consolidatable_receivables', {
      p_customer_id: 9,
      p_voyage_id: 4,
      p_search: 'CSC1',
    })
  })

  it('normaliza números nas linhas, preservando nulls e zerando valores ausentes', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: [
        {
          receivable_id: '5',
          customer_id: '9',
          voyage_id: null,
          individual_invoice_id: '3',
          balance_brl: '10.5',
          original_amount_brl: null,
          bl_id: 'CSC1',
        },
        {
          receivable_id: 6,
          customer_id: 9,
          voyage_id: '12',
          individual_invoice_id: null,
          balance_brl: null,
          original_amount_brl: 99,
          bl_id: 'CSC2',
        },
      ],
      error: null,
    })

    const rows = await listConsolidatableReceivables({ customerId: 9 })

    expect(rows).toEqual([
      {
        receivable_id: 5,
        customer_id: 9,
        voyage_id: null,
        individual_invoice_id: 3,
        balance_brl: 10.5,
        original_amount_brl: 0,
        bl_id: 'CSC1',
      },
      {
        receivable_id: 6,
        customer_id: 9,
        voyage_id: 12,
        individual_invoice_id: null,
        balance_brl: 0,
        original_amount_brl: 99,
        bl_id: 'CSC2',
      },
    ])
  })

  it('retorna vazio quando data é null e propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await listConsolidatableReceivables({ customerId: 9 })).toEqual([])

    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('rpc falhou') })
    await expect(listConsolidatableReceivables({ customerId: 9 })).rejects.toThrow('rpc falhou')
  })
})

describe('createConsolidatedInvoice', () => {
  it('chama o RPC create_local_consolidated_invoice e persiste o payload PIX', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: { invoice_id: 7, invoice_number: 'INV-7', total_brl: 100 },
      error: null,
    })
    const update = invoiceUpdateQuery({ error: null })
    supabaseMocks.from.mockReturnValueOnce(update.builder)

    const result = await createConsolidatedInvoice({ customerId: 10, receivableIds: [1, 2] })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('create_local_consolidated_invoice', {
      p_customer_id: 10,
      p_receivable_ids: [1, 2],
      p_actor: null,
    })
    expect(supabaseMocks.buildPix).toHaveBeenCalledWith(100, 'INV-7')
    expect(supabaseMocks.from).toHaveBeenCalledWith('invoices')
    expect(update.update).toHaveBeenCalledWith({ pix_payload: 'pix-payload' })
    expect(update.eq).toHaveBeenCalledWith('id', 7)
    expect(result).toEqual({ invoice_id: 7, invoice_number: 'INV-7', total_brl: 100 })
  })

  it('não persiste PIX quando total_brl é zero ou falta invoice_number', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({
      data: { invoice_id: 8, invoice_number: 'INV-8', total_brl: 0 },
      error: null,
    })
    expect(await createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).toEqual({
      invoice_id: 8,
      invoice_number: 'INV-8',
      total_brl: 0,
    })

    supabaseMocks.rpc.mockResolvedValueOnce({
      data: { invoice_id: 9, invoice_number: null, total_brl: 50 },
      error: null,
    })
    await createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })

    expect(supabaseMocks.buildPix).not.toHaveBeenCalled()
    expect(supabaseMocks.from).not.toHaveBeenCalled()
  })

  it('retorna data crua (null inclusive) sem tentar PIX', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).toBeNull()
    expect(supabaseMocks.from).not.toHaveBeenCalled()
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('consolidada falhou') })
    await expect(createConsolidatedInvoice({ customerId: 10, receivableIds: [1] })).rejects.toThrow(
      'consolidada falhou',
    )
  })
})

describe('registerLedgerInvoicePayment', () => {
  it('chama o RPC register_ledger_invoice_payment com defaults (pix/manual, demais null)', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { payment_id: 1 }, error: null })

    const result = await registerLedgerInvoicePayment({ invoiceId: 1, amountBrl: 50 })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('register_ledger_invoice_payment', {
      p_invoice_id: 1,
      p_amount_brl: 50,
      p_method: 'pix',
      p_paid_at: null,
      p_pix_txid: null,
      p_source: 'manual',
      p_notes: null,
      p_actor: null,
    })
    expect(result).toEqual({ payment_id: 1 })
  })

  it('repassa todos os campos com notes aparado; notes só de espaços vira null', async () => {
    supabaseMocks.rpc.mockResolvedValue({ data: null, error: null })

    await registerLedgerInvoicePayment({
      invoiceId: 2,
      amountBrl: 99.9,
      method: 'ted',
      paidAt: '2026-06-01T10:00:00',
      pixTxid: 'TX123',
      source: 'pix_extract',
      notes: '  ok  ',
    })
    expect(supabaseMocks.rpc).toHaveBeenCalledWith('register_ledger_invoice_payment', {
      p_invoice_id: 2,
      p_amount_brl: 99.9,
      p_method: 'ted',
      p_paid_at: '2026-06-01T10:00:00',
      p_pix_txid: 'TX123',
      p_source: 'pix_extract',
      p_notes: 'ok',
      p_actor: null,
    })

    await registerLedgerInvoicePayment({ invoiceId: 2, amountBrl: 1, notes: '   ' })
    expect(supabaseMocks.rpc).toHaveBeenLastCalledWith(
      'register_ledger_invoice_payment',
      expect.objectContaining({ p_notes: null }),
    )
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('pagamento falhou') })
    await expect(registerLedgerInvoicePayment({ invoiceId: 1, amountBrl: 50 })).rejects.toThrow('pagamento falhou')
  })
})

describe('reconcileInvoicePaymentByTxid', () => {
  it('chama o RPC reconcile_invoice_payment_by_txid com paid_at default null', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: { matched: true }, error: null })

    const result = await reconcileInvoicePaymentByTxid({ txid: 'TX1', amountBrl: 99.9 })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('reconcile_invoice_payment_by_txid', {
      p_txid: 'TX1',
      p_amount_brl: 99.9,
      p_paid_at: null,
    })
    expect(result).toEqual({ matched: true })
  })

  it('repassa paidAt quando informado', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null })

    await reconcileInvoicePaymentByTxid({ txid: 'TX2', amountBrl: 10, paidAt: '2026-06-02T08:00:00' })

    expect(supabaseMocks.rpc).toHaveBeenCalledWith('reconcile_invoice_payment_by_txid', {
      p_txid: 'TX2',
      p_amount_brl: 10,
      p_paid_at: '2026-06-02T08:00:00',
    })
  })

  it('propaga erro do RPC', async () => {
    supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('reconciliação falhou') })
    await expect(reconcileInvoicePaymentByTxid({ txid: 'TX1', amountBrl: 1 })).rejects.toThrow('reconciliação falhou')
  })
})
