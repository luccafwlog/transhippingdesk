import type { BL } from '../types/database'

export type PipelineBL = Pick<
  BL,
  | 'review_status'
  | 'customer_reconciliation_status'
  | 'charge_status'
  | 'financial_status'
>

export type CardState = 'green' | 'yellow' | 'red'

export type PipelineCard = {
  label: string
  detail: string
  state: CardState
  href?: string
}

export function getBlPipelineCards(bl: PipelineBL): PipelineCard[] {
  return [reviewCard(bl), customerCard(bl), chargesCard(bl), financialCard(bl)]
}

function reviewCard(bl: PipelineBL): PipelineCard {
  const s = bl.review_status
  if (s === 'reviewed') return { label: 'Revisao', detail: 'Revisado', state: 'green' }
  if (s === 'ok') return { label: 'Revisao', detail: 'OK', state: 'green' }
  return { label: 'Revisao', detail: 'Pendente', state: 'red', href: '/revisao' }
}

function customerCard(bl: PipelineBL): PipelineCard {
  const s = bl.customer_reconciliation_status
  if (s === 'reconciled') return { label: 'Cliente', detail: 'Reconciliado', state: 'green' }
  if (s === 'matched_document' || s === 'matched_name') return { label: 'Cliente', detail: 'Aguardando confirmar', state: 'yellow' }
  if (s === 'missing_customer') return { label: 'Cliente', detail: 'Não identificado', state: 'red', href: '/clientes' }
  if (s === 'rejected') return { label: 'Cliente', detail: 'Rejeitado', state: 'red', href: '/clientes' }
  return { label: 'Cliente', detail: 'Pendente', state: 'yellow' }
}

function chargesCard(bl: PipelineBL): PipelineCard {
  const s = bl.charge_status
  if (s === 'ready_for_billing' || s === 'exempt') return { label: 'Taxas', detail: 'Pronto p/ faturar', state: 'green' }
  if (s === 'reviewed') return { label: 'Taxas', detail: 'Revisado', state: 'yellow' }
  if (s === 'calculated' || s === 'review_required') return { label: 'Taxas', detail: 'Calculado', state: 'yellow' }
  return { label: 'Taxas', detail: 'Não calculado', state: 'red', href: '/taxas-locais' }
}

function financialCard(bl: PipelineBL): PipelineCard {
  const s = bl.financial_status
  if (s === 'paid') return { label: 'Financeiro', detail: 'Pago', state: 'green' }
  if (s === 'invoiced') return { label: 'Financeiro', detail: 'Faturado', state: 'yellow', href: '/faturamento' }
  if (s === 'cancelled') return { label: 'Financeiro', detail: 'Cancelado', state: 'red' }
  return { label: 'Financeiro', detail: 'Pendente', state: 'yellow', href: '/faturamento' }
}
