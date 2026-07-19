// Neutraliza injeção de fórmula (CSV/Excel injection). Um valor iniciado por
// = + - @ ou tab/CR é interpretado como fórmula ao abrir no Excel/Sheets;
// prefixar com aspa simples força o tratamento como texto literal.
export const FORMULA_INJECTION_PREFIX = /^[=+\-@\t\r]/

export function sanitizeCellValue<T>(value: T): T | string {
  if (typeof value === 'string' && FORMULA_INJECTION_PREFIX.test(value)) {
    return `'${value}`
  }
  return value
}

export function sanitizeSheetRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      out[key] = sanitizeCellValue(value)
    }
    return out
  })
}
