import { describe, expect, it } from 'vitest'
import { buildFinancialRail, buildOperationalRail, pickNextAction } from '../blRails'

const baseBl = {
  id: 'BL1', voyage_id: 7, cargo_mode: 'container', ce_mercante: null, review_status: 'pending_review',
  customer_reconciliation_status: 'missing_customer', customer_id: null, charge_status: 'not_calculated', financial_status: 'pending',
} as Parameters<typeof buildFinancialRail>[0]['bl']

describe('B/L rails', () => {
  it('mantem saida pendente sem ATD e mostra ETD como detalhe', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: { etd: '2026-07-01', atd: null }, podSchedule: { eta: '2026-07-20', ata: null }, containers: [], omission: null })
    expect(rail[0]).toMatchObject({ key: 'pol', state: 'pending', detail: expect.stringMatching(/ETD/) })
  })
  it('marca POD como desviado quando ha omissao', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: { etd: null, atd: '2026-07-02' }, podSchedule: null, containers: [], omission: { omittedPod: 'VITORIA', dischargePod: 'SANTOS' } })
    expect(rail[1]).toMatchObject({ key: 'pod', state: 'diverted' })
    expect(rail[1].detail).toMatch(/SANTOS/)
  })
  it('conta descarga e devolucao por container distinto', () => {
    const rail = buildOperationalRail({ bl: baseBl, polSchedule: null, podSchedule: null, omission: null, containers: [
      { container_number: 'ABCD1234567', discharge_date: '2026-07-21', return_date: '2026-07-25' },
      { container_number: 'ABCD7654321', discharge_date: '2026-07-21', return_date: null },
    ] })
    expect(rail[2].detail).toBe('2/2 descarregados')
    expect(rail[3].detail).toBe('1/2 devolvidos')
  })
  it('seleciona o primeiro pendente financeiro como proxima acao', () => {
    const rail = buildFinancialRail({ bl: baseBl, latestInvoice: null, demurrageInvoices: [] })
    expect(rail[0]).toMatchObject({ key: 'ce', state: 'pending' })
    expect(pickNextAction(rail)?.key).toBe('ce')
  })
  it('fecha o trilho pago sem inventar demurrage', () => {
    const rail = buildFinancialRail({ bl: { ...baseBl, ce_mercante: '123', review_status: 'reviewed', customer_reconciliation_status: 'reconciled', customer_id: 9, charge_status: 'ready_for_billing', financial_status: 'paid' } as never, latestInvoice: { id: 1, status: 'paid', total_brl: 100 }, demurrageInvoices: [] })
    expect(rail.every((s) => s.state === 'done')).toBe(true)
    expect(pickNextAction(rail)).toBeNull()
  })
})
