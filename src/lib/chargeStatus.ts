// Predicados canônicos de charge_status do B/L. Fonte única do agrupamento
// Pendente / Pronto para faturar / Isento usado em resumos, filtros e métricas.
// Nunca reimplemente estas comparações inline nas páginas.

export function isChargePending(status: string | null | undefined) {
  return status === 'review_required' || status === 'not_calculated'
}

export function isChargeReady(status: string | null | undefined) {
  return status === 'ready_for_billing'
}

export function isChargeExempt(status: string | null | undefined) {
  return status === 'exempt'
}

export function summarizeChargeStatuses(rows: Array<{ charge_status?: string | null }>) {
  return {
    pending: rows.filter((row) => isChargePending(row.charge_status)).length,
    ready: rows.filter((row) => isChargeReady(row.charge_status)).length,
    exempt: rows.filter((row) => isChargeExempt(row.charge_status)).length,
  }
}
