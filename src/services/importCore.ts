// Helpers compartilhados pelos parsers de importação de planilhas.
// Extraído de vaziosImport/graniteImport (audit T11) — apenas a interseção
// visível entre os parsers, sem framework genérico.

import { normalizeHeader } from '../lib/utils'

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
    const normalized = normalizeHeader(originalKey)
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
export type SheetReadOptions = {
  dates?: 'texto' | 'date'
  values?: 'formatado' | 'cru'
  skipBlankRows?: boolean
  sheetIndex?: number
  /** Aliases used to locate a header row after an optional title/preamble. */
  expectedHeaders?: readonly string[]
  headerWindow?: number
  /** Fallback Windows-1252 somente para origem autorizada; default UTF-8 estrito. */
  allowWindows1252Fallback?: boolean
}

export type SheetContent = {
  headers: string[]
  matrix: unknown[][]
  rows: SheetRow[]
  headerRowIndex: number
}

/** Linha de planilha com a linha física 1-based preservada da origem. */
export type SheetRow = Record<string, unknown> & { readonly rowNumber: number }

export async function readSheet(buffer: ArrayBuffer, options: SheetReadOptions = {}): Promise<SheetContent> {
  const wantDates = options.dates === 'date'
  const raw = options.values === 'cru' || wantDates
  const XLSX = await import('@e965/xlsx')
  const { decodeImportBytes, detectImportFormat } = await import('./importText')
  // XLS/XLSX binário nunca passa pelo decoder textual. CSV é texto com BOM e
  // UTF-8 estrito; fallback Windows-1252 só pode ser optado pelo importer que
  // conhece e autoriza essa origem. EDI não é aceito pelo leitor de planilhas.
  const format = detectImportFormat(buffer, { allowWindows1252Fallback: options.allowWindows1252Fallback })
  if (format === 'edi') throw new Error('Arquivo EDI recebido no leitor de planilhas. Use o parser EDI correspondente.')
  const workbook = format === 'xlsx' || format === 'xls'
    ? XLSX.read(buffer, {
      type: 'array',
      cellText: !wantDates,
      cellDates: wantDates,
    })
    : XLSX.read(decodeImportBytes(buffer, { allowWindows1252Fallback: options.allowWindows1252Fallback }).text, {
        type: 'string',
        cellText: !wantDates,
        cellDates: wantDates,
      })
  const firstSheet = workbook.Sheets[workbook.SheetNames[options.sheetIndex ?? 0]]
  if (!firstSheet) throw new Error('Arquivo sem abas validas.')

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: '',
    blankrows: true,
    raw,
  })
  if (!matrix.length) throw new Error('Planilha vazia.')
  const headerRowIndex = options.expectedHeaders
    ? locateHeaderRowIndex(matrix, options.expectedHeaders, options.headerWindow ?? 5)
    : 0
  if (headerRowIndex < 0) throw new Error('Cabeçalho não encontrado na janela inicial da planilha.')

  const headers = (matrix[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim())
  const rowsWithSheetMetadata = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: '',
    raw,
    blankrows: !(options.skipBlankRows ?? true),
    range: headerRowIndex,
  })
  const rows = rowsWithSheetMetadata.map((row, index): SheetRow | null => {
    const rowNumber = typeof row.__rowNum__ === 'number'
      ? row.__rowNum__ + 1
      : headerRowIndex + index + 2
    const data = { ...row }
    delete data.__rowNum__
    const hasValue = Object.values(data).some((value) => {
      if (value === null || value === undefined) return false
      return typeof value === 'string' ? value.trim() !== '' : true
    })
    if ((options.skipBlankRows ?? true) && !hasValue) return null
    Object.defineProperty(data, 'rowNumber', {
      value: rowNumber,
      enumerable: false,
      configurable: false,
      writable: false,
    })
    return data as SheetRow
  }).filter((row): row is SheetRow => row !== null)
  if (!rows.length) throw new Error('Planilha vazia.')
  return { headers, matrix, rows, headerRowIndex }
}

export async function readFirstSheetRows(buffer: ArrayBuffer): Promise<SheetRow[]> {
  const { rows } = await readSheet(buffer)
  return rows
}

/** Localiza a linha de cabeçalho em janela pequena do template; recusa múltiplos candidatos. */
export function locateHeaderRowIndex(
  matrix: unknown[][],
  expectedNormalized: readonly string[],
  window = 5,
): number {
  const expected = new Set(expectedNormalized.map(normalizeHeader))
  const candidates: number[] = []
  const limit = Math.min(matrix.length, window)
  for (let i = 0; i < limit; i += 1) {
    const cells = (matrix[i] ?? []).map((cell) => normalizeHeader(String(cell ?? ''))).filter(Boolean)
    if (cells.some((cell) => expected.has(cell))) candidates.push(i)
  }
  if (candidates.length > 1) {
    throw new Error(`Cabeçalho ambíguo: múltiplas linhas candidatas (${candidates.map((i) => i + 1).join(', ')}).`)
  }
  return candidates[0] ?? -1
}

export type HeaderSpec<F extends string> = {
  readonly aliases: Readonly<Record<F, readonly string[]>>
  readonly required: readonly F[]
}

export function matchHeaders<F extends string>(
  headers: readonly string[],
  spec: HeaderSpec<F>,
): { columnByField: Partial<Record<F, string>>; missing: F[] } {
  const columnByField: Partial<Record<F, string>> = {}
  for (const field of Object.keys(spec.aliases) as F[]) {
    const accepted = new Set(spec.aliases[field].map(normalizeHeader))
    const found = headers.find((header) => accepted.has(normalizeHeader(header)))
    if (found !== undefined) columnByField[field] = found
  }
  const missing = spec.required.filter((field) => columnByField[field] === undefined)
  return { columnByField, missing }
}
