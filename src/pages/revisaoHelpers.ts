// Predicados puros e normalização de erros para a fila de revisão.
import type { ReviewQueueItem } from '../hooks/useReview'

export function normalizeConsignee(value?: string | null) {
  return value?.trim() || ''
}

export function getConsigneeFilterOptions(items: ReviewQueueItem[]) {
  return Array.from(new Set(items.map((item) => normalizeConsignee(item.consignee)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  )
}

export function getSelectionConsignee(items: ReviewQueueItem[]) {
  const normalized = items.map((item) => normalizeConsignee(item.consignee))
  if (normalized.some((consignee) => !consignee)) return null
  const consignees = new Set(normalized)
  return consignees.size === 1 ? [...consignees][0] : null
}

export function needsCustomerLink(item: ReviewQueueItem) {
  return item.customer_id == null
}

export function needsCeMercante(item: ReviewQueueItem) {
  if (item.source !== 'bl') return false
  return (item.review_reasons ?? []).some((reason) => /ce\s*mercante/i.test(reason))
}

export function needsWeightFix(item: ReviewQueueItem) {
  if (item.source !== 'bl') return false
  if ((item.review_reasons ?? []).some((reason) => /weight ton|peso bb/i.test(reason))) return true
  // Carga solta (BB) sem peso em toneladas: o calculo de taxas exige bb_weight_ton.
  return item.cargo_mode === 'carga_solta' && (item.bb_weight_ton == null || Number(item.bb_weight_ton) <= 0)
}

export function extractErrorText(error: unknown) {
  if (!error) return ''
  if (error instanceof Error) return error.message.toLowerCase()
  if (typeof error === 'string') return error.toLowerCase()
  if (typeof error === 'object') {
    const candidate = error as { message?: string | null; details?: string | null; code?: string | null; hint?: string | null }
    return [candidate.code, candidate.message, candidate.details, candidate.hint]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  }
  return ''
}
