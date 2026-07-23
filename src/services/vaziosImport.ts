import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, readFirstSheetRows, type RowError } from './importCore'
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'
import { normalizePortCode } from './portCode'

const HEADER_MAP: Record<string, string> = {
  booking: 'booking_number', 'booking number': 'booking_number', container: 'container_number', conteiner: 'container_number',
  tipo: 'container_type', type: 'container_type', 'data movimentação': 'movement_date', 'data movimentacao': 'movement_date', data: 'movement_date',
  'terminal origem': 'origin_terminal', origem: 'origin_terminal', destino: 'destination', destination: 'destination', observações: 'notes', observacoes: 'notes', notes: 'notes', highlights: 'notes',
  'porto embarque': 'embark_port', porto: 'embark_port', pol: 'embark_port', pod: 'embark_port', depot: 'depot', material: 'material',
  'hand-in': 'hand_in_date', 'hand in': 'hand_in_date', 'hand-out': 'hand_out_date', 'hand out': 'hand_out_date', 'import empty return date': 'hand_in_date', 'empty gate out': 'hand_out_date', 'load date': 'movement_date',
  overtime: 'overtime_pct', ot: 'overtime_pct', 'overtime %': 'overtime_pct', 'ot %': 'overtime_pct', 'order no.': 'os_number', 'order no': 'os_number', 'current status': 'condition',
}

type ParsedVaziosBooking = {
  rowNumber: number
  booking_number: string | null
  container_number: string
  container_type: string | null
  movement_date: string | null
  origin_terminal: string | null
  destination: string | null
  notes: string | null
  embark_port: string | null
  depot: string | null
  material: boolean
  hand_in_date: string | null
  hand_out_date: string | null
  condition: 'empty' | 'damage' | 'material' | null
  os_number: string | null
  overtime_pct?: number
}

export type ParsedVaziosManifest = { bookings: ParsedVaziosBooking[]; rowErrors: RowError[] }

export async function parseVaziosManifestFile(file: File): Promise<ParsedVaziosManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  return parseVaziosManifestBuffer(await file.arrayBuffer())
}

export async function parseVaziosManifestBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosManifest> {
  const rows = await readFirstSheetRows(buffer)
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)
  const bookings: ParsedVaziosBooking[] = []
  const rowErrors = createRowErrorCollector()
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2
    const mapped = mapRow(row)
    const containerNumber = String(mapped.container_number ?? '').trim().toUpperCase()
    if (!containerNumber) { rowErrors.add(rowNumber, 'Container ausente — linha ignorada.', row); return }
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
    const condition = parseCondition(mapped.condition, mapped.material)
    bookings.push({
      rowNumber, booking_number: String(mapped.booking_number ?? '').trim() || null, container_number: containerNumber,
      container_type: text(mapped.container_type), movement_date: parseDate(String(mapped.movement_date ?? '')),
      origin_terminal: text(mapped.origin_terminal), destination: text(mapped.destination), notes: text(mapped.notes),
      embark_port: normalizePortCode(String(mapped.embark_port ?? '')) ?? null, depot: text(mapped.depot),
      material: condition === 'material' || parseBool(mapped.material),
      hand_in_date: parseDate(String(mapped.hand_in_date ?? '')), hand_out_date: parseDate(String(mapped.hand_out_date ?? '')),
      condition, os_number: text(mapped.os_number),
      overtime_pct: parsePercent(mapped.overtime_pct, undefined),
    })
  })
  const deduped = dedupeByContainer(bookings, rowErrors)
  return { bookings: deduped, rowErrors: rowErrors.errors }
}

function dedupeByContainer(bookings: ParsedVaziosBooking[], rowErrors: ReturnType<typeof createRowErrorCollector>): ParsedVaziosBooking[] {
  const lastByContainer = new Map<string, ParsedVaziosBooking>()
  for (const booking of bookings) lastByContainer.set(booking.container_number, booking)
  for (const booking of bookings) {
    if (lastByContainer.get(booking.container_number) !== booking) {
      rowErrors.add(booking.rowNumber, `Container ${booking.container_number} duplicado na planilha — mantida a última ocorrência.`, booking)
    }
  }
  return [...lastByContainer.values()]
}

function text(value: unknown): string | null { const valueText = String(value ?? '').trim(); return valueText || null }
function parseBool(value: unknown): boolean { return ['sim', 's', 'x', 'true', '1', 'yes'].includes(String(value ?? '').trim().toLowerCase()) }
function parsePercent(value: unknown, flag: unknown): number { const parsed = Number(String(value ?? '').replace(',', '.').replace('%', '').trim()); return Number.isFinite(parsed) && parsed >= 0 ? parsed : (flag !== undefined && parseBool(flag) ? 100 : 0) }
function parseCondition(value: unknown, material: unknown): ParsedVaziosBooking['condition'] { const normalized = String(value ?? '').trim().toLowerCase(); if (normalized.includes('material')) return 'material'; if (normalized.includes('damage') || normalized.includes('avaria')) return 'damage'; if (normalized.includes('empty') || normalized.includes('vazio')) return 'empty'; return parseBool(material) ? 'material' : null }
function parseDate(value: string): string | null {
  if (!value) return null
  const serial = Number(value)
  if (Number.isFinite(serial) && serial > 1) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return null
  const [, day, month, rawYear] = match
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

export type ImportVaziosArgs = { filename: string; voyageId: number; port: string; manifest: ParsedVaziosManifest; uploadedBy: string; description?: string }

export async function importVaziosManifest({ voyageId, port, manifest, uploadedBy }: ImportVaziosArgs): Promise<{ manifestId: string }> {
  const p_bookings = manifest.bookings.map((booking) => Object.fromEntries(Object.entries(booking).filter(([key]) => key !== 'rowNumber')))
  const { data, error } = await supabase.rpc('import_vazios_bookings_transactional', { p_voyage_id: voyageId, p_port: port, p_uploaded_by: uploadedBy, p_bookings })
  if (error) throw error
  return { manifestId: (data as { manifest_id: string }).manifest_id }
}

export async function listVaziosBookings(filters: { voyageId?: string; search?: string; page?: number; pageSize?: number }) {
  const page = filters.page ?? 1; const pageSize = filters.pageSize ?? 20; const from = (page - 1) * pageSize; const to = from + pageSize - 1
  let query = supabase.from('vazios_bookings').select('*, manifest:vazios_manifests(id, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name)))', { count: 'exact' }).range(from, to).order('created_at', { ascending: false })
  if (filters.search) { const search = escapeFilterTerm(filters.search); if (search) query = query.or(`booking_number.ilike.%${search}%,container_number.ilike.%${search}%`) }
  if (filters.voyageId) { query = query.eq('voyage_id', Number(filters.voyageId)) }
  const { data, error, count } = await query; if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
