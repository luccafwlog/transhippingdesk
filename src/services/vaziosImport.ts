import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, readFirstSheetRows, type RowError } from './importCore'
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'

const HEADER_MAP: Record<string, string> = {
  container: 'container_number', conteiner: 'container_number', 'container number': 'container_number',
  tipo: 'container_type', type: 'container_type',
  local: 'local_code', origem: 'local_code', depot: 'local_code', 'local de origem': 'local_code', 'origin location': 'local_code',
  condição: 'condition', condicao: 'condition', condition: 'condition', status: 'condition',
  'hand-in': 'hand_in_date', 'hand in': 'hand_in_date', entrada: 'hand_in_date', 'gate in': 'hand_in_date',
  'hand-out': 'hand_out_date', 'hand out': 'hand_out_date', saída: 'hand_out_date', saida: 'hand_out_date', 'gate out': 'hand_out_date',
  embarque: 'movement_date', 'data embarque': 'movement_date', 'load date': 'movement_date', data: 'movement_date',
}

export type ParsedVaziosBooking = {
  rowNumber: number
  booking_number?: string | null
  origin_terminal?: string | null
  destination?: string | null
  notes?: string | null
  depot?: string | null
  material?: boolean
  overtime_pct?: number
  os_number?: string | null
  embark_port?: string | null
  container_number: string
  container_type: string | null
  local_code?: string | null
  condition: 'vazio' | 'material' | 'empty' | null
  hand_in_date: string | null
  hand_out_date: string | null
  movement_date: string | null
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
    if (!containerNumber) { rowErrors.add(rowNumber, 'Container ausente.', row); return }
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
    const condition = parseCondition(mapped.condition)
    if (!condition) rowErrors.add(rowNumber, `Container ${containerNumber}: condição deve ser vazio ou material.`, row)
    const localCode = text(mapped.local_code)
    if (!localCode) rowErrors.add(rowNumber, `Container ${containerNumber}: local de origem obrigatório.`, row)
    bookings.push({
      rowNumber, container_number: containerNumber, container_type: text(mapped.container_type), local_code: localCode,
      condition, hand_in_date: parseDate(String(mapped.hand_in_date ?? '')),
      hand_out_date: parseDate(String(mapped.hand_out_date ?? '')), movement_date: parseDate(String(mapped.movement_date ?? '')),
    })
  })
  return { bookings: dedupeByContainer(bookings), rowErrors: rowErrors.errors }
}

export function parseCondition(value: unknown): ParsedVaziosBooking['condition'] {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'material' || normalized === 'com material' || normalized === 'loaded') return 'material'
  if (normalized === 'vazio' || normalized === 'empty') return 'vazio'
  return null
}

function dedupeByContainer(bookings: ParsedVaziosBooking[]): ParsedVaziosBooking[] {
  const lastByContainer = new Map<string, ParsedVaziosBooking>()
  for (const booking of bookings) lastByContainer.set(booking.container_number, booking)
  return [...lastByContainer.values()]
}

function text(value: unknown): string | null { const valueText = String(value ?? '').trim(); return valueText || null }

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
  // Importação de unidades diverge do importCore: uma divergência aborta o lote inteiro.
  if (manifest.rowErrors.length) throw new Error(manifest.rowErrors.map((error) => `Linha ${error.row}: ${error.message}`).join('\n'))
  const p_bookings = manifest.bookings.map((booking) => Object.fromEntries(Object.entries(booking).filter(([key]) => key !== 'rowNumber')))
  const { data, error } = await supabase.rpc('import_vazios_bookings_transactional', { p_voyage_id: voyageId, p_port: port, p_uploaded_by: uploadedBy, p_bookings })
  if (error) throw error
  return { manifestId: (data as { manifest_id: string }).manifest_id }
}

export async function listVaziosBookings(filters: { voyageId?: string; search?: string; page?: number; pageSize?: number }) {
  const page = filters.page ?? 1; const pageSize = filters.pageSize ?? 20; const from = (page - 1) * pageSize; const to = from + pageSize - 1
  let query = supabase.from('vazios_bookings').select('*, manifest:vazios_manifests(id, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name)))', { count: 'exact' }).range(from, to).order('created_at', { ascending: false })
  if (filters.search) { const search = escapeFilterTerm(filters.search); if (search) query = query.or(`container_number.ilike.%${search}%`) }
  if (filters.voyageId) query = query.eq('voyage_id', Number(filters.voyageId))
  const { data, error, count } = await query; if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
