import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, readFirstSheetRows, type RowError } from './importCore'
import { supabase } from './supabase'
import { escapeFilterTerm } from '../lib/utils'

const HEADER_MAP: Record<string, string> = {
  'booking': 'booking_number',
  'booking number': 'booking_number',
  'container': 'container_number',
  'conteiner': 'container_number',
  'contêiner': 'container_number',
  'tipo': 'container_type',
  'type': 'container_type',
  'data movimentação': 'movement_date',
  'data movimentacao': 'movement_date',
  'data': 'movement_date',
  'terminal origem': 'origin_terminal',
  'origem': 'origin_terminal',
  'destino': 'destination',
  'destination': 'destination',
  'observações': 'notes',
  'observacoes': 'notes',
  'notes': 'notes',
}

type ParsedVaziosBooking = {
  rowNumber: number
  booking_number: string
  container_number: string | null
  container_type: string | null
  movement_date: string | null
  origin_terminal: string | null
  destination: string | null
  notes: string | null
}

export type ParsedVaziosManifest = {
  bookings: ParsedVaziosBooking[]
  rowErrors: RowError[]
}

export async function parseVaziosManifestFile(file: File): Promise<ParsedVaziosManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseVaziosManifestBuffer(buffer)
}

async function parseVaziosManifestBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosManifest> {
  const rows = await readFirstSheetRows(buffer)
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)

  const bookings: ParsedVaziosBooking[] = []
  const rowErrors = createRowErrorCollector()

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2
    const mapped = mapRow(row)

    const bookingNumber = String(mapped['booking_number'] ?? '').trim()
    if (!bookingNumber) {
      rowErrors.add(rowNumber, 'Booking ausente — linha ignorada.', row)
      return
    }

    const containerNumber = String(mapped['container_number'] ?? '').trim() || null
    if (containerNumber && !/^[A-Z]{4}\d{7}$/.test(containerNumber)) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
    }

    bookings.push({
      rowNumber,
      booking_number: bookingNumber,
      container_number: containerNumber,
      container_type: String(mapped['container_type'] ?? '').trim() || null,
      movement_date: parseDateBR(String(mapped['movement_date'] ?? '')),
      origin_terminal: String(mapped['origin_terminal'] ?? '').trim() || null,
      destination: String(mapped['destination'] ?? '').trim() || null,
      notes: String(mapped['notes'] ?? '').trim() || null,
    })
  })

  return { bookings, rowErrors: rowErrors.errors }
}

function parseDateBR(value: string): string | null {
  if (!value) return null
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!match) return null
  const [, d, m, y] = match
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export type ImportVaziosArgs = {
  filename: string
  voyageId: number
  manifest: ParsedVaziosManifest
  uploadedBy: string
  description?: string
}

export async function importVaziosManifest({
  voyageId,
  manifest,
  uploadedBy,
  description,
}: ImportVaziosArgs): Promise<{ manifestId: string }> {
  const bookings = manifest.bookings.map((b) => ({
      booking_number: b.booking_number,
      container_number: b.container_number,
      container_type: b.container_type,
      movement_date: b.movement_date,
      origin_terminal: b.origin_terminal,
      destination: b.destination,
      notes: b.notes,
  }))

  const { data, error } = await supabase.rpc('import_vazios_bookings_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_bookings: bookings,
  })
  if (error) throw error
  const result = data as { manifest_id: string }
  return { manifestId: result.manifest_id }
}

export async function listVaziosBookings(filters: {
  voyageId?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('vazios_bookings')
    .select(
      `*, manifest:vazios_manifests(id, voyage_id, voyage:voyages(id, voyage_number, vessel:vessels(id, name)))`,
      { count: 'exact' },
    )
    .range(from, to)
    .order('created_at', { ascending: false })

  if (filters.search) {
    const search = escapeFilterTerm(filters.search)
    if (search) {
      query = query.or(
        `booking_number.ilike.%${search}%,container_number.ilike.%${search}%`,
      )
    }
  }

  if (filters.voyageId) {
    const { data: manifestIds } = await supabase
      .from('vazios_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    const ids = (manifestIds ?? []).map((m: { id: string }) => m.id)
    if (!ids.length) return { rows: [], count: 0 }
    query = query.in('manifest_id', ids)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
