// Regra de prazo do ADR (Agency Departure Report) por departamento.
//
// Prazo = ATD + 3 dias uteis (segunda a sexta; sabado e domingo nao contam;
// feriados contam como dia util - simplificacao deliberada, sem calendario
// de feriados). O dia do ATD nunca conta. O prazo vence ao fim do 3º dia
// util. Ver docs/adr/0039-prazo-de-conclusao-do-adr-medido-por-departamento.md.

/** Estado de prazo por departamento, derivado do ATD e da assinatura vigente. */
export type AgencyReportDeadlineState = 'no-deadline' | 'on-time' | 'overdue'

export type AgencyReportDeadlineInput = {
  /** ATD da escala unificada, formato YYYY-MM-DD (sem componente de hora). */
  atd: string | null
  /** Escala omitida pelo armador: excluida da medicao permanentemente. */
  omitted: boolean
  /** Timestamp ISO da assinatura vigente do departamento, ou null se nao assinado. */
  signedAt: string | null
  /** Instante de referencia ("agora"), injetado para manter a funcao pura/testavel. */
  now: string | Date
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Calcula a data do prazo (YYYY-MM-DD) a partir de um ATD (YYYY-MM-DD),
 * somando 3 dias uteis (segunda a sexta). O dia do ATD nunca conta.
 * Retorna null se `atd` nao estiver no formato YYYY-MM-DD.
 */
export function calculateAgencyReportDeadlineDate(atd: string): string | null {
  const match = atd.match(DATE_ONLY_PATTERN)
  if (!match) return null

  const [, yearStr, monthStr, dayStr] = match
  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)

  // Usa UTC para evitar deslocamento por fuso horario local ao somar dias.
  const cursor = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(cursor.getTime())) return null

  let businessDaysAdded = 0
  while (businessDaysAdded < 3) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay() // 0 = domingo, 6 = sabado
    if (weekday !== 0 && weekday !== 6) {
      businessDaysAdded += 1
    }
  }

  const deadlineYear = cursor.getUTCFullYear()
  const deadlineMonth = String(cursor.getUTCMonth() + 1).padStart(2, '0')
  const deadlineDay = String(cursor.getUTCDate()).padStart(2, '0')
  return `${deadlineYear}-${deadlineMonth}-${deadlineDay}`
}

/** Extrai a parte YYYY-MM-DD de um timestamp ISO (ou de uma data-only string). */
function toDateOnly(value: string): string | null {
  const dateOnlyMatch = value.match(DATE_ONLY_PATTERN)
  if (dateOnlyMatch) return dateOnlyMatch[0]

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Deriva o estado de prazo do ADR para um departamento a partir do ATD,
 * da flag de escala omitida e da assinatura vigente (ou de "agora" quando
 * ainda nao assinado). Comparacao por data (sem hora): assinar/observar
 * exatamente no dia do prazo conta como "no prazo".
 */
export function deriveAgencyReportDeadlineState(input: AgencyReportDeadlineInput): AgencyReportDeadlineState {
  const { atd, omitted, signedAt, now } = input

  if (omitted) return 'no-deadline'
  if (!atd) return 'no-deadline'

  const deadlineDate = calculateAgencyReportDeadlineDate(atd)
  if (!deadlineDate) return 'no-deadline'

  if (signedAt) {
    const signedDate = toDateOnly(signedAt)
    if (!signedDate) return 'no-deadline'
    return signedDate <= deadlineDate ? 'on-time' : 'overdue'
  }

  const nowValue = typeof now === 'string' ? now : now.toISOString()
  const nowDate = toDateOnly(nowValue)
  if (!nowDate) return 'no-deadline'

  return nowDate <= deadlineDate ? 'on-time' : 'overdue'
}
