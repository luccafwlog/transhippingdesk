/**
 * Junta os campos típicos de um erro do Supabase/Postgres (`code`, `message`,
 * `details`, `hint`) numa única string legível para exibição e correspondência.
 *
 * Preserva o casing original — fontes de exibição (toasts, "Motivo: ...") usam o
 * texto como está. Quem precisa fazer match por substring (`.includes('42501')`,
 * `.includes('permission denied')`) deve aplicar `.toLowerCase()` no ponto de uso.
 * Manter o casing aqui evita o fork histórico em que cada feature reimplementava
 * este helper com regras de casing divergentes.
 */
export function extractErrorText(error: unknown): string {
  if (!error) return ''
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object') {
    const candidate = error as {
      code?: string | null
      message?: string | null
      details?: string | null
      hint?: string | null
    }
    return [candidate.code, candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ').trim()
  }
  return ''
}
