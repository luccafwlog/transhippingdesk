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
export type DbErrorKind = 'permissao' | 'sessao_expirada' | 'conflito' | 'limite' | 'validacao' | 'desconhecido'
export type ClassifiedDbError = { kind: DbErrorKind; message: string }

const ERROR_TABLE: Readonly<Record<string, ClassifiedDbError>> = {
  '42501': { kind: 'permissao', message: 'Sem permissao para esta acao. Solicite acesso administrativo.' },
  PGRST301: { kind: 'sessao_expirada', message: 'Sua sessao expirou. Entre novamente para continuar.' },
  '28000': { kind: 'sessao_expirada', message: 'Sua sessao expirou. Entre novamente para continuar.' },
  '23505': { kind: 'conflito', message: 'Este registro ja existe.' },
  '23503': { kind: 'validacao', message: 'Registro referenciado nao existe ou ainda esta em uso.' },
  '23514': { kind: 'validacao', message: 'Dados fora das regras do cadastro.' },
  '22P02': { kind: 'validacao', message: 'Valor em formato invalido.' },
  P0429: { kind: 'limite', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
  '57014': { kind: 'limite', message: 'A consulta demorou demais. Reduza o periodo e tente novamente.' },
}

export function classifyDbError(error: unknown): ClassifiedDbError {
  const fields = error instanceof Error
    ? { code: '', message: error.message }
    : typeof error === 'string' ? { code: '', message: error }
      : error && typeof error === 'object'
        ? { code: String((error as { code?: unknown }).code ?? ''), message: String((error as { message?: unknown }).message ?? '') }
        : { code: '', message: '' }
  const known = ERROR_TABLE[fields.code]
  const raw = /permission denied for (?:table|view|function|relation|schema|sequence)/i.test(fields.message)
  if (known) return { kind: known.kind, message: fields.message && !raw ? fields.message : known.message }
  if (/permission denied/i.test(fields.message)) return ERROR_TABLE['42501']
  return { kind: 'desconhecido', message: fields.message || 'Falha inesperada. Tente novamente.' }
}
