// Mapa central de códigos de status -> labels pt-BR exibidos na UI.
// Nunca exiba o código cru (ex: PENDING_REVIEW) para o usuário; use estes
// helpers e caia no próprio código apenas como último recurso.

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  pending_review: 'Pendente',
  reviewed: 'Revisado',
}

export const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  invoiced: 'Faturado',
  paid: 'Pago',
  cancelled: 'Cancelado',
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  issued: 'Emitida',
  partially_paid: 'Parcialmente paga',
  paid: 'Paga',
  covered: 'Coberta',
  obsolete: 'Obsoleta',
  overdue: 'Vencida',
  cancelled: 'Cancelada',
}

export const VOYAGE_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  completed: 'Concluída',
  cancelled: 'Cancelada',
}

export function statusLabel(map: Record<string, string>, status: string | null | undefined, fallback = '-') {
  if (!status) return fallback
  return map[status] ?? status
}

export function simNao(value: boolean) {
  return value ? 'SIM' : 'NÃO'
}
