// Contrato de saída compartilhado dos imports (S03 §§2.5, 3.5, 6.2).
// ImportIssue é a única forma de reportar divergência: sem `raw` (nunca vai
// à telemetria), com severidade explícita para canImport.
import { z } from 'zod'

export type ImportIssueCode =
  | 'invalid_number'
  | 'ambiguous_number'
  | 'invalid_date'
  | 'missing_header'
  | 'unknown_port'
  | 'invalid_iso'
  | 'invalid_group'
  | 'ambiguous_voyage'

export type ImportIssue = {
  row: number
  field: string
  code: ImportIssueCode
  severity: 'error' | 'warning'
  message: string
}

export function hasBlockingIssues(issues: readonly ImportIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error')
}

/** canImport usa erro bloqueante e conjunto aplicável, não só quantidade. */
export function canImportPreview(hasRows: boolean, issues: readonly ImportIssue[]): boolean {
  return hasRows && !hasBlockingIssues(issues)
}

// ponytail: máscara mínima para nunca vazar email cru em mensagem exportada/telemetria.
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export function sanitizeIssueMessage(message: string): string {
  return message.replace(EMAIL_PATTERN, '[email]')
}

export function formatIssuesAsCsv(issues: readonly ImportIssue[]): string {
  const header = 'row,field,code,severity,message'
  const lines = issues.map((issue) =>
    [issue.row, issue.field, issue.code, issue.severity, `"${sanitizeIssueMessage(issue.message).replace(/"/g, '""')}"`].join(','),
  )
  return [header, ...lines].join('\n')
}

export function downloadIssuesCsv(filename: string, issues: readonly ImportIssue[]): void {
  const blob = new Blob([formatIssuesAsCsv(issues)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

// Schemas Zod concretos de saída (S03 §6.2): primitivas compartilhadas,
// sem framework genérico.
export const IsoContainerSchema = z
  .string()
  .regex(/^[A-Z]{4}\d{7}$/, 'formato ISO esperado (XXXX0000000)')

export const LocodeSchema = z.string().regex(/^[A-Z]{5}$/, 'LOCODE esperado (5 letras)')

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data ISO esperada (AAAA-MM-DD)')

export const NonNegativeDecimalSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, 'decimal canônico esperado')
  .refine((value) => Number(value) >= 0, 'valor não pode ser negativo')
