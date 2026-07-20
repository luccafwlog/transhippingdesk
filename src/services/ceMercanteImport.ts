import { assertUploadFile } from '../lib/fileGuard'
import { asString, chunkArray, normalizeHeader, onlyDigits } from '../lib/utils'
import { supabase } from './supabase'
import type { CeMercanteEdiRow } from './ceMercanteEdiParser'
import { maybeAutoBillAfterCeMercante } from './reviewBillingAutomation'

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

export async function partitionRowsByVoyage<T extends { bl_id: string; rowNumber?: number; lineNumber?: number }>(
  rows: T[],
  voyageId: number,
): Promise<{ rows: T[]; blocked: Array<{ row: number; bl_id: string; message: string }> }> {
  const voyageByBl = new Map<string, number | null>()
  for (const chunk of chunkArray(Array.from(new Set(rows.map((row) => row.bl_id))), 400)) {
    const { data, error } = await supabase.from('bls').select('id, voyage_id').in('id', chunk)
    if (error) throw error
    for (const bl of data ?? []) voyageByBl.set(String(bl.id), bl.voyage_id)
  }

  const blocked: Array<{ row: number; bl_id: string; message: string }> = []
  const validRows = rows.filter((row) => {
    const rowVoyageId = voyageByBl.get(row.bl_id)
    if (rowVoyageId === undefined || rowVoyageId === voyageId) return true
    blocked.push({
      row: row.rowNumber ?? row.lineNumber ?? 0,
      bl_id: row.bl_id,
      message: `B/L ${row.bl_id} pertence a outra viagem`,
    })
    return false
  })
  return { rows: validRows, blocked }
}

const CE_MERCANTE_LENGTH = 15

export async function parseCeMercanteFile(file: File): Promise<ParsedCeMercanteFile> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseCeMercanteBuffer(buffer)
}

export async function parseCeMercanteBuffer(buffer: ArrayBuffer): Promise<ParsedCeMercanteFile> {
  const XLSX = await import('@e965/xlsx')
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
    void maybeAutoBillAfterCeMercante(row.bl_id, options.changedBy).catch(() => {})
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

export type CeMercanteEdiImportResult =
  | {
      ok: true
      batchId: number
      processed: number
      inserted: number
      overwritten: number
      unchanged: number
    }
  | {
      ok: false
      errors: Array<{ bl_id?: string; ce?: string; message: string }>
    }

// Importa o vinculo CE <-> BL a partir do arquivo EDI do manifesto. Toda a
// validacao quantitativa (cobertura do batch) e qualitativa (CE/BL unicos,
// existencia) e feita dentro da RPC transacional: ou grava tudo, ou nada.
export async function importCeMercanteEdi(
  rows: CeMercanteEdiRow[],
  options: { changedBy: string | null } = { changedBy: null },
): Promise<CeMercanteEdiImportResult> {
  const payload = rows.map((row) => ({ bl_id: row.bl_id, ce: row.ce_mercante }))

  const { data, error } = await supabase.rpc('apply_ce_mercante_manifest', {
    p_rows: payload,
    p_changed_by: options.changedBy,
  })

  if (error) throw error

  const result = data as {
    ok?: boolean
    batch_id?: number
    processed?: number
    inserted?: number
    overwritten?: number
    unchanged?: number
    errors?: Array<{ bl_id?: string; ce?: string; message: string }>
  } | null

  if (result?.ok) {
    for (const blId of new Set(rows.map((row) => row.bl_id))) {
      void maybeAutoBillAfterCeMercante(blId, options.changedBy).catch(() => {})
    }
    return {
      ok: true,
      batchId: Number(result.batch_id ?? 0),
      processed: Number(result.processed ?? 0),
      inserted: Number(result.inserted ?? 0),
      overwritten: Number(result.overwritten ?? 0),
      unchanged: Number(result.unchanged ?? 0),
    }
  }

  return {
    ok: false,
    errors: result?.errors ?? [{ message: 'Falha ao validar o manifesto de CE Mercante.' }],
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

function normalizeBlId(value: unknown) {
  return asString(value).toUpperCase()
}

function normalizeCeMercante(value: unknown) {
  const digits = onlyDigits(asString(value))
  return digits || ''
}
