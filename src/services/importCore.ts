// Helpers compartilhados pelos parsers de importação de planilhas.
// Extraído de vaziosImport/graniteImport (audit T11) — apenas a interseção
// visível entre os parsers, sem framework genérico.

/** Erro de linha acumulado durante o parse, no formato comum aos parsers. */
export type RowError = { row: number; message: string; raw: unknown }

/** Coletor de erros de linha no padrão `{ row, message, raw }` dos parsers. */
export function createRowErrorCollector() {
  const errors: RowError[] = []
  return {
    errors,
    add(row: number, message: string, raw: unknown) {
      errors.push({ row, message, raw })
    },
  }
}

/**
 * Constrói um mapeador de linha a partir do HEADER_MAP do parser:
 * normaliza cada cabeçalho da planilha (trim + lowercase) e associa à
 * chave canônica da coluna. Cabeçalhos não reconhecidos são ignorados.
 */
export function createHeaderMapper(
  sampleRow: Record<string, unknown>,
  headerMap: Record<string, string>,
): (row: Record<string, unknown>) => Record<string, unknown> {
  const colMapping: Record<string, string> = {}
  for (const originalKey of Object.keys(sampleRow)) {
    const normalized = originalKey.trim().toLowerCase()
    const mapped = headerMap[normalized]
    if (mapped) colMapping[originalKey] = mapped
  }

  return (row) => {
    const mapped: Record<string, unknown> = {}
    for (const [originalKey, fieldName] of Object.entries(colMapping)) {
      mapped[fieldName] = row[originalKey]
    }
    return mapped
  }
}

/**
 * Lê a primeira aba de um buffer XLSX como linhas-objeto, espelhando o
 * padrão dos parsers (import dinâmico do xlsx, `cellText`, `defval: ''`,
 * `raw: false`). Lança com as mesmas mensagens dos parsers originais.
 */
export async function readFirstSheetRows(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) throw new Error('Arquivo sem abas validas.')

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: false })
  if (!rows.length) throw new Error('Planilha vazia.')

  return rows
}
