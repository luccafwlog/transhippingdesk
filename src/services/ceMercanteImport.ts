import { asString, onlyDigits } from '../lib/utils'
import { supabase } from './supabase'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading', 'numero bl', 'n bl', 'no bl', 'no. bl'],
  ce_mercante: ['ce mercante', 'ce_mercante', 'ce', 'numero ce mercante', 'ce merc'],
} as const

const requiredHeaders = {
  bl_id: 'BL',
  ce_mercante: 'CE MERCANTE',
} as const

type DestinationField = keyof typeof headerMap

export type CeMercanteRow = {
  rowNumber: number
  bl_id: string
  ce_mercante: string
}

export type ParsedCeMercanteFile = {
  rows: CeMercanteRow[]
  rowErrors: Array<{
    row: number
    message: string
    raw: unknown
  }>
}

export type CeMercanteImportResult = {
  processed: number
  updated: number
  overwritten: number
  unchanged: number
  errorCount: number
  errors: Array<{
    row: number
    message: string
    bl_id?: string
  }>
}

const CE_MERCANTE_LENGTH = 15

export async function parseCeMercanteFile(file: File): Promise<ParsedCeMercanteFile> {
  const buffer = await file.arrayBuffer()
  return parseCeMercanteBuffer(buffer)
}

export async function parseCeMercanteBuffer(buffer: ArrayBuffer): Promise<ParsedCeMercanteFile> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

  if (!firstSheet) {
    throw new Error('Arquivo sem abas validas.')
  }

  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(firstSheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  })

  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())
  validateRequiredHeaders(rawHeaders)

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: '',
    raw: false,
  })

  return parseRows(objectRows)
}

export async function importCeMercanteRows(
  rows: CeMercanteRow[],
  options: { changedBy: string | null } = { changedBy: null },
): Promise<CeMercanteImportResult> {
  const errors: CeMercanteImportResult['errors'] = []
  const existingBlIds = new Set<string>()
  const uniqueBlIds = Array.from(new Set(rows.map((row) => row.bl_id)))

  for (const chunk of chunkArray(uniqueBlIds, 400)) {
    const { data, error } = await supabase.from('bls').select('id').in('id', chunk)
    if (error) throw error

    for (const row of data ?? []) {
      existingBlIds.add(String(row.id))
    }
  }

  const validRows = rows.filter((row) => {
    if (!existingBlIds.has(row.bl_id)) {
      errors.push({
        row: row.rowNumber,
        bl_id: row.bl_id,
        message: `BL ${row.bl_id} nao encontrado no sistema.`,
      })
      return false
    }

    return true
  })

  let overwritten = 0
  let unchanged = 0
  let inserted = 0

  for (const row of validRows) {
    const { data, error } = await supabase.rpc('apply_ce_mercante_update', {
      p_bl_id: row.bl_id,
      p_new_ce: row.ce_mercante,
      p_changed_by: options.changedBy,
    })

    if (error) {
      errors.push({
        row: row.rowNumber,
        bl_id: row.bl_id,
        message: error.message || `Falha ao aplicar CE Mercante no BL ${row.bl_id}.`,
      })
      continue
    }

    switch (data) {
      case 'overwritten':
        overwritten += 1
        break
      case 'unchanged':
        unchanged += 1
        break
      default:
        inserted += 1
        break
    }
  }

  return {
    processed: rows.length,
    updated: inserted + overwritten,
    overwritten,
    unchanged,
    errorCount: errors.length,
    errors,
  }
}

function parseRows(rows: Record<string, unknown>[]): ParsedCeMercanteFile {
  const rowErrors: ParsedCeMercanteFile['rowErrors'] = []
  const validRows: CeMercanteRow[] = []
  const seenBls = new Set<string>()

  rows.forEach((row, index) => {
    const mapped = mapRow(row)
    const rowNumber = index + 2
    const bl_id = normalizeBlId(mapped.bl_id)
    const ce_mercante = normalizeCeMercante(mapped.ce_mercante)

    if (!bl_id || !ce_mercante) {
      rowErrors.push({
        row: rowNumber,
        message: 'Colunas obrigatorias ausentes ou invalidas.',
        raw: row,
      })
      return
    }

    // F-11: o CE Mercante brasileiro tem 15 digitos. Valores menores sao
    // tipicamente erros de digitacao / importacao de celulas truncadas.
    if (ce_mercante.length !== CE_MERCANTE_LENGTH) {
      rowErrors.push({
        row: rowNumber,
        message: `CE Mercante invalido para o BL ${bl_id}: esperado ${CE_MERCANTE_LENGTH} digitos, recebido ${ce_mercante.length}.`,
        raw: row,
      })
      return
    }

    if (seenBls.has(bl_id)) {
      rowErrors.push({
        row: rowNumber,
        message: `BL ${bl_id} repetido na planilha de CE Mercante.`,
        raw: row,
      })
      return
    }

    seenBls.add(bl_id)
    validRows.push({
      rowNumber,
      bl_id,
      ce_mercante,
    })
  })

  return {
    rows: validRows,
    rowErrors,
  }
}

function validateRequiredHeaders(rawHeaders: string[]) {
  const normalizedHeaders = rawHeaders.map((header) => normalizeHeader(header))
  const missing = Object.entries(requiredHeaders)
    .filter(([, label]) => !normalizedHeaders.includes(normalizeHeader(label)))
    .map(([, label]) => label)

  if (missing.length) {
    throw new Error(`Planilha invalida. Colunas obrigatorias: ${missing.join(', ')}.`)
  }
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}

  Object.entries(row).forEach(([header, value]) => {
    const normalizedHeader = normalizeHeader(header)
    const destination = Object.entries(headerMap).find(([, candidates]) =>
      candidates.some((candidate) => normalizedHeader === normalizeHeader(candidate)),
    )?.[0] as DestinationField | undefined

    if (destination && mapped[destination] === undefined) {
      mapped[destination] = value
    }
  })

  return mapped
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeBlId(value: unknown) {
  return asString(value).toUpperCase()
}

function normalizeCeMercante(value: unknown) {
  const digits = onlyDigits(asString(value))
  return digits || ''
}

function chunkArray<T>(values: T[], chunkSize: number) {
  if (!values.length) return []

  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize))
  }
  return chunks
}
