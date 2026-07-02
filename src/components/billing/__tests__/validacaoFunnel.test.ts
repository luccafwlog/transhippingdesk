import { describe, expect, it } from 'vitest'
import { getBillingBlockReason, isPendingBillingReview } from '../validacaoPipeline'

// Regressão: B/L com CNPJ casado, taxas calculadas e travado no gate de revisão
// (portal não provisionado) precisa aparecer no funil "Em revisão" e mostrar a
// pendência real — antes ficava "sumido" (fora do funil) com motivo enganoso.
const gatedBl = {
  customer_reconciliation_status: 'matched_document',
  financial_status: 'pending',
  charge_status: 'calculated',
  review_status: 'pending_review',
  notes: 'Pendencias de importacao: Acesso ao portal nao provisionado',
  billing_hold_reason: null,
  customer_reconciliation_notes: null,
  charge_exemption_reason: null,
  customer: { id: 1 },
  totals: { total_brl: 100, line_count: 1, review_required_count: 0 },
}

describe('isPendingBillingReview', () => {
  it('conta o B/L reconciliado que ainda não é faturável', () => {
    expect(isPendingBillingReview(gatedBl)).toBe(true)
  })

  it('não conta B/L pronto, faturado ou isento', () => {
    expect(isPendingBillingReview({ ...gatedBl, charge_status: 'ready_for_billing' })).toBe(false)
    expect(isPendingBillingReview({ ...gatedBl, financial_status: 'invoiced' })).toBe(false)
    expect(isPendingBillingReview({ ...gatedBl, charge_status: 'exempt' })).toBe(false)
  })

  it('não conta B/L ainda pendente de conciliação (fica no passo anterior)', () => {
    expect(isPendingBillingReview({ ...gatedBl, customer_reconciliation_status: 'matched_name' })).toBe(false)
  })
})

describe('getBillingBlockReason', () => {
  it('mostra a pendência de provisionamento do portal', () => {
    expect(getBillingBlockReason(gatedBl)).toBe('Revisão pendente: Acesso ao portal nao provisionado')
  })

  it('cai num motivo genérico quando não há pendência anotada', () => {
    expect(getBillingBlockReason({ ...gatedBl, notes: null })).toBe('Revisão pendente antes do faturamento.')
  })
})
