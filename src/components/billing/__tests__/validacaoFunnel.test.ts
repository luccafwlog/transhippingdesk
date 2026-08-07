import { describe, expect, it } from 'vitest'
import { getBillingBlockReason, isAwaitingCeMercante, isBlLockedForRecalc, isPendingBillingReview } from '../validacaoPipeline'

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

// Etapa 2 do plano de faturamento (ADR 0038, achado 6): recalculo em lote pula
// B/L ja faturado em vez de deixar o RPC recusar como erro.
describe('isBlLockedForRecalc', () => {
  it('trava invoiced, partially_paid e paid', () => {
    expect(isBlLockedForRecalc('invoiced')).toBe(true)
    expect(isBlLockedForRecalc('partially_paid')).toBe(true)
    expect(isBlLockedForRecalc('paid')).toBe(true)
  })

  it('libera pending e nulo', () => {
    expect(isBlLockedForRecalc('pending')).toBe(false)
    expect(isBlLockedForRecalc(null)).toBe(false)
    expect(isBlLockedForRecalc(undefined)).toBe(false)
  })
})

// Etapa 6 do plano de faturamento (ADR 0038, decisão 8): "aguardando CE" é o
// motivo mais comum de um B/L de container ficar provisório depois que a
// promoção automática saiu (migration 263).
describe('isAwaitingCeMercante', () => {
  const baseAwaiting = {
    cargo_mode: 'container',
    financial_status: 'pending',
    ce_mercante: null as string | null,
    charge_status: 'calculated',
    customer_reconciliation_status: 'matched_document',
  }

  it('B/L de container reconciliado, calculado e pendente sem CE aguarda CE', () => {
    expect(isAwaitingCeMercante(baseAwaiting)).toBe(true)
    expect(isAwaitingCeMercante({ ...baseAwaiting, ce_mercante: '  ' })).toBe(true)
  })

  it('nao aguarda CE quando ja tem CE, ja faturou, ou nao e container', () => {
    expect(isAwaitingCeMercante({ ...baseAwaiting, ce_mercante: '123' })).toBe(false)
    expect(isAwaitingCeMercante({ ...baseAwaiting, financial_status: 'invoiced' })).toBe(false)
    expect(isAwaitingCeMercante({ ...baseAwaiting, cargo_mode: 'carga_solta' })).toBe(false)
    expect(isAwaitingCeMercante({ ...baseAwaiting, cargo_mode: 'granito' })).toBe(false)
  })

  // Achado 9 da review da PR 501: antes o predicado ignorava charge_status e
  // conciliação, contando TODO o backlog de container aberto como
  // "aguardando CE", nao so quem de fato so falta o CE Mercante.
  it('nao aguarda CE quando ainda nao foi calculado ou cliente nao esta reconciliado', () => {
    expect(isAwaitingCeMercante({ ...baseAwaiting, charge_status: 'not_calculated' })).toBe(false)
    expect(isAwaitingCeMercante({ ...baseAwaiting, customer_reconciliation_status: 'missing_customer' })).toBe(false)
  })

  it('ainda aguarda CE quando isento seria excluido, mas revisao pendente conta', () => {
    expect(isAwaitingCeMercante({ ...baseAwaiting, charge_status: 'exempt' })).toBe(false)
    expect(isAwaitingCeMercante({ ...baseAwaiting, charge_status: 'review_required' })).toBe(true)
  })
})
