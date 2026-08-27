import { describe, expect, it, vi } from 'vitest'

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { from: mockFrom, rpc: mockRpc } }))

const { buildConsolidatedBalance, buildCustomerTimeline, fetchCustomerPendingReconciliation, fetchCustomerReceivables } = await import('../customerFicha')

describe('buildConsolidatedBalance', () => {
  it('soma local emitido não pago (emitida e parcial) + demurrage não pago', () => {
    expect(buildConsolidatedBalance(
      // 'overdue' saiu do domínio das taxas locais na 348 (#605): mesmo que uma
      // linha histórica chegue com esse status, ela não entra no saldo.
      [
        { status: 'issued', balance_brl: 100 },
        { status: 'overdue', balance_brl: 300 },
        { status: 'partially_paid', balance_brl: 40 },
        { status: 'paid', balance_brl: 999 },
        { status: 'cancelled', balance_brl: 999 },
      ],
      [{ status: 'issued', current_total_brl: 50 }, { status: 'overdue', current_total_brl: 25 }, { status: 'paid', current_total_brl: 999 }, { status: 'cancelled', current_total_brl: 999 }],
    )).toEqual({ localBrl: 140, demurrageBrl: 75, totalBrl: 215 })
  })
})

describe('buildCustomerTimeline', () => {
  it('mescla fontes e ordena do mais recente para o mais antigo', () => {
    const events = buildCustomerTimeline({
      auditLogs: [{ id: 1, field_name: 'name', old_value: 'A', new_value: 'B', changed_at: '2026-07-02T10:00:00Z', justification: 'ajuste', changed_by: null }],
      portalEvents: [{ id: 2, new_decision: 'authorized', new_situation: null, reason: null, created_at: '2026-07-03T10:00:00Z' }],
      contacts: [{ id: 3, name: 'Contato', created_at: '2026-07-01T10:00:00Z' }],
      customerId: 101,
      localInvoices: [{ id: 4, invoice_number: 'INV-1', issued_at: '2026-07-04T10:00:00Z', status: 'issued' }],
      payments: [{ id: 9, amount_brl: 100, paid_at: '2026-07-06T10:00:00Z', invoice: { id: 4, invoice_number: 'INV-1' } }],
      demurrageInvoices: [{ id: 5, doc_number: 'DEM-1', billed_at: '2026-07-05T10:00:00Z', paid_at: null, status: 'issued' }],
      bls: [{ id: 'BL1', created_at: '2026-06-30T10:00:00Z' }],
    })
    expect(events.map((event) => event.kind)).toEqual(['local_payment', 'demurrage_invoice_issued', 'local_invoice_issued', 'portal_event', 'cadastro_audit', 'contact_created', 'bl_created'])
    expect(events[0].at).toBe('2026-07-06T10:00:00Z')
    expect(events.find((event) => event.kind === 'local_invoice_issued')?.link).toBe('/taxas-locais?customer=101&invoice=4')
    expect(events.find((event) => event.kind === 'local_payment')?.link).toBe('/taxas-locais?customer=101&invoice=4')
  })
})

describe('fetchCustomerPendingReconciliation', () => {
  it('nao lista vinculo por documento exato (matched_document) como pendente, so matched_name', async () => {
    const rows = [
      { id: 'BL1', consignee: 'ACME', customer_reconciliation_status: 'matched_document' },
      { id: 'BL2', consignee: 'BETA', customer_reconciliation_status: 'matched_name' },
    ]
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      overrideTypes: vi.fn(() => Promise.resolve({ data: rows, error: null })),
    }
    mockFrom.mockReturnValue(builder)

    const result = await fetchCustomerPendingReconciliation(101)

    expect(result).toEqual([{ id: 'BL2', consignee: 'BETA', customer_reconciliation_status: 'matched_name' }])
  })
})

describe('fetchCustomerReceivables — le via RPC para distinguir vazio de restrito', () => {
  it('retorna as linhas da RPC get_customer_receivables', async () => {
    const rows = [{ id: 1, bl_id: 'BL1', original_amount_brl: 10, settled_amount_brl: 0, balance_brl: 10, status: 'open' }]
    mockRpc.mockResolvedValue({ data: rows, error: null })

    const result = await fetchCustomerReceivables(101)

    expect(mockRpc).toHaveBeenCalledWith('get_customer_receivables', { p_customer_id: 101 })
    expect(result).toEqual({ rows, denied: false })
  })

  it('marca denied quando a RPC recusa por falta de permissao (42501)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Usuario sem permissao ativa.' } })

    const result = await fetchCustomerReceivables(101)

    expect(result).toEqual({ rows: [], denied: true })
  })
})
