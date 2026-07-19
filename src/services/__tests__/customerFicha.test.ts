import { describe, expect, it } from 'vitest'
import { buildConsolidatedBalance, buildCustomerTimeline } from '../customerFicha'

describe('buildConsolidatedBalance', () => {
  it('soma local emitido + demurrage não pago com decomposição', () => {
    expect(buildConsolidatedBalance(
      [{ status: 'issued', balance_brl: 100 }, { status: 'overdue', balance_brl: 300 }, { status: 'paid', balance_brl: 999 }],
      [{ status: 'issued', current_total_brl: 50 }, { status: 'overdue', current_total_brl: 25 }, { status: 'paid', current_total_brl: 999 }, { status: 'cancelled', current_total_brl: 999 }],
    )).toEqual({ localBrl: 100, demurrageBrl: 75, totalBrl: 175 })
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
      demurrageInvoices: [{ id: 5, doc_number: 'DEM-1', billed_at: '2026-07-05T10:00:00Z', paid_at: null, status: 'issued' }],
      bls: [{ id: 'BL1', created_at: '2026-06-30T10:00:00Z' }],
    })
    expect(events.map((event) => event.kind)).toEqual(['demurrage_invoice_issued', 'local_invoice_issued', 'portal_event', 'cadastro_audit', 'contact_created', 'bl_created'])
    expect(events[0].at).toBe('2026-07-05T10:00:00Z')
    expect(events.find((event) => event.kind === 'local_invoice_issued')?.link).toBe('/faturamento?customer=101&invoice=4')
  })
})
