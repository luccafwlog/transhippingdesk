import { normalizeText } from '../lib/utils'
import { supabase } from './supabase'
import { calculateDemurrage } from './demurrage'

const headerMap = {
  bl_id: ['bl', 'b/l', 'bill of lading'],
  container_number: ['container', 'container number', 'numero do container'],
  discharge_date: ['discharge', 'descarga', 'data descarga', 'data de descarga'],
  return_date: ['return', 'devolucao', 'retorno', 'data devolucao', 'data de devolucao'],
} as const

type DestinationField = keyof typeof headerMap

export type ContainerDatesImportRow = {
  bl_id: string
  container_number: string
  discharge_date: string
  return_date: string | null
}

export type ParsedContainerDatesImport = {
  rows: ContainerDatesImportRow[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseContainerDatesFile(file: File): Promise<ParsedContainerDatesImport> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]

  if (!firstSheet) throw new Error('Arquivo sem abas validas.')

  const matrix = XLSX.utils.sheet_to_json<(unknown)[]>(firstSheet, { header: 1, defval: '', blankrows: false })
  const rawHeaders = (matrix[0] ?? []).map((cell) => String(cell ?? '').trim())

  const normalizedHeaders = rawHeaders.map((h) => normalizeText(h))
  const missingRequired = (['bl_id', 'container_number', 'discharge_date'] as const).filter(
    (field) => !headerMap[field].some((candidate) => normalizedHeaders.includes(normalizeText(candidate))),
  )
  if (missingRequired.length) {
    throw new Error(`Colunas obrigatorias ausentes: ${missingRequired.join(', ')}.`)
  }

  const objectRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  return parseRows(objectRows)
}

export async function importContainerDates(rows: ContainerDatesImportRow[]) {
  if (!rows.length) return { updated: 0, unchanged: 0, missing: 0 }

  const blIds = Array.from(new Set(rows.map((r) => r.bl_id)))

  const { data: containers, error: fetchError } = await supabase
    .from('bl_containers')
    .select('id, bl_id, container_number, container_type, discharge_date, return_date, demurrage_status')
    .in('bl_id', blIds)

  if (fetchError) throw fetchError

  const { data: bls, error: blsError } = await supabase
    .from('bls')
    .select('id, free_time_override, demurrage_rate_override_p1_usd, demurrage_rate_override_p2_usd')
    .in('id', blIds)

  if (blsError) throw blsError

  const blOverrides = new Map(bls?.map((b) => [b.id, b]) ?? [])

  type ContainerRow = { id: number; bl_id: string | null; container_number: string; container_type: string | null; discharge_date: string | null; return_date: string | null; demurrage_status: string | null }
  const containersByKey = new Map<string, ContainerRow>()
  for (const c of (containers as unknown as ContainerRow[]) ?? []) {
    containersByKey.set(makeKey(c.bl_id ?? '', c.container_number), c)
  }

  let updated = 0
  let unchanged = 0
  let missing = 0

  const uniqueRows = Array.from(new Map(rows.map((r) => [makeKey(r.bl_id, r.container_number), r])).values())

  for (const row of uniqueRows) {
    const container = containersByKey.get(makeKey(row.bl_id, row.container_number))
    if (!container) { missing += 1; continue }

    const sameDischarge = container.discharge_date === row.discharge_date
    const sameReturn = container.return_date === (row.return_date ?? null)
    if (sameDischarge && sameReturn) { unchanged += 1; continue }

    const bl = blOverrides.get(row.bl_id)
    const newStatus = resolveStatus(
      row.discharge_date,
      row.return_date,
      container.container_type,
      bl?.free_time_override ?? null,
      bl?.demurrage_rate_override_p1_usd ?? null,
      bl?.demurrage_rate_override_p2_usd ?? null,
    )

    const { error: updateError } = await supabase
      .from('bl_containers')
      .update({ discharge_date: row.discharge_date, return_date: row.return_date ?? null, demurrage_status: newStatus as 'within_free_time' | 'overdue' | 'returned' })
      .eq('id', container.id)

    if (updateError) throw updateError
    updated += 1
  }

  return { updated, unchanged, missing }
}

function resolveStatus(
  dischargeDate: string,
  returnDate: string | null,
  containerType: string | null,
  freeTimeOverride: number | null,
  ov1: number | null,
  ov2: number | null,
): string {
  if (returnDate) return 'returned'
  const today = new Date().toISOString().slice(0, 10)
  const result = calculateDemurrage(containerType, dischargeDate, today, freeTimeOverride, ov1, ov2)
  return result.total_usd > 0 ? 'overdue' : 'within_free_time'
}

function parseRows(objectRows: Record<string, unknown>[]): ParsedContainerDatesImport {
  const rows: ContainerDatesImportRow[] = []
  const rowErrors: ParsedContainerDatesImport['rowErrors'] = []

  objectRows.forEach((row, index) => {
    const mapped = mapRow(row)
    const blId = asString(mapped.bl_id).toUpperCase()
    const containerNumber = asString(mapped.container_number).toUpperCase()
    const rawDischarge = mapped.discharge_date
    const rawReturn = mapped.return_date

    if (!blId) { rowErrors.push({ row: index + 2, message: 'Linha sem BL.', raw: row }); return }
    if (!containerNumber) { rowErrors.push({ row: index + 2, message: 'Linha sem Container.', raw: row }); return }

    const discharge = parseDate(rawDischarge)
    if (!discharge) { rowErrors.push({ row: index + 2, message: 'Data de descarga invalida ou ausente.', raw: row }); return }

    const returnDate = rawReturn != null && asString(rawReturn) ? parseDate(rawReturn) : null
    if (rawReturn != null && asString(rawReturn) && !returnDate) {
      rowErrors.push({ row: index + 2, message: 'Data de devolucao invalida.', raw: row }); return
    }

    rows.push({ bl_id: blId, container_number: containerNumber, discharge_date: discharge, return_date: returnDate })
  })

  return {
    rows: Array.from(new Map(rows.map((r) => [makeKey(r.bl_id, r.container_number), r])).values()),
    rowErrors,
  }
}

function parseDate(value: unknown): string | null {
  if (!value) return null
  // XLSX cellDates:true returns Date objects
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (!s) return null
  // ISO format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // Brazilian format DD/MM/YYYY or DD-MM-YYYY
  const parts = s.split(/[-/]/)
  if (parts.length === 3 && parts[0].length <= 2) {
    const [d, m, y] = parts
    const iso = `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  }
  return null
}

function mapRow(row: Record<string, unknown>) {
  const mapped: Partial<Record<DestinationField, unknown>> = {}
  for (const [header, value] of Object.entries(row)) {
    const normalizedHeader = normalizeText(header)
    const destination = (Object.entries(headerMap) as [DestinationField, readonly string[]][]).find(([, candidates]) =>
      candidates.some((c) => normalizedHeader === normalizeText(c)),
    )?.[0]
    if (destination && mapped[destination] === undefined) mapped[destination] = value
  }
  return mapped
}

function makeKey(blId: string, containerNumber: string) {
  return `${String(blId).toUpperCase()}::${String(containerNumber).toUpperCase()}`
}

function asString(value: unknown) {
  return String(value ?? '').trim()
}
