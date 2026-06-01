// Predicados puros que classificam o que falta em um item da fila de revisão,
// e normalização de texto de erro. Extraídos de Revisao.tsx para teste isolado.
// `ReviewQueueItem` é import de tipo (apagado em runtime) — sem dependência de
// hooks/Supabase aqui.
import type { ReviewQueueItem } from '../hooks/useReview'

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
