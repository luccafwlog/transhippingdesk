import { isCustomerReconciliationResolved } from '../../services/customerReconciliation'
import { extractReviewReasons } from '../../hooks/useReview'
import { isBlFinanciallyLocked } from '../../lib/chargeStatus'

// B/L reconciliado que ainda não é faturável: preso entre a conciliação de cliente
// e o "pronto faturar" (gate de revisão pendente, taxa em revisão ou apenas
// calculado aguardando marcação). Existe para o funil não "sumir" com esses B/Ls.
export function isPendingBillingReview(row: {
  customer_reconciliation_status: string | null
  financial_status: string | null
  charge_status: string | null
}) {
  return (
    isCustomerReconciliationResolved(row.customer_reconciliation_status) &&
    row.financial_status !== 'invoiced' &&
    row.charge_status !== 'ready_for_billing' &&
    row.charge_status !== 'exempt'
  )
}

export function getBillingBlockReason(row: {
  charge_status: string | null
  financial_status: string | null
  review_status: string | null
  notes: string | null
  billing_hold_reason: string | null
  customer_reconciliation_status: string | null
  customer_reconciliation_notes: string | null
  charge_exemption_reason: string | null
  customer?: { id: number | null } | null
  totals: { total_brl: number; line_count: number; review_required_count: number }
}) {
  if (row.financial_status === 'invoiced') return 'Fatura ja emitida.'
  if (row.billing_hold_reason) return row.billing_hold_reason
  if (!row.customer?.id) return 'Cliente nao vinculado.'
  if (!isCustomerReconciliationResolved(row.customer_reconciliation_status)) {
    return row.customer_reconciliation_notes ?? 'Conciliação de cliente pendente.'
  }
  if (row.review_status === 'pending_review') {
    const reasons = extractReviewReasons(row.notes)
    return reasons.length ? `Revisão pendente: ${reasons.join(', ')}` : 'Revisão pendente antes do faturamento.'
  }
  if (row.charge_status === 'exempt') return row.charge_exemption_reason ?? 'B/L isento de taxas locais.'
  if (row.totals.review_required_count > 0) return 'Ha linhas de taxa com revisao pendente.'
  if (row.totals.line_count === 0 || Number(row.totals.total_brl ?? 0) <= 0) return 'Sem linhas de taxa calculadas.'
  if (row.charge_status !== 'ready_for_billing') return 'Ainda nao marcado como pronto para faturar.'
  return 'Pronto para emissao individual.'
}

// Etapa 2 do plano de faturamento (ADR 0038, achado 6): recalculo em lote nunca
// toca B/L ja faturado — o RPC recusaria, e contar isso como erro genérico
// esconde que a causa é a fatura já emitida, não uma falha.
export const isBlLockedForRecalc = isBlFinanciallyLocked
