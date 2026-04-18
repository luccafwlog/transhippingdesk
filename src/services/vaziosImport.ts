import { supabase } from './supabase'

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

export type ParsedVaziosBooking = {
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
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseVaziosManifestFile(file: File): Promise<ParsedVaziosManifest> {
  const buffer = await file.arrayBuffer()
  return parseVaziosManifestBuffer(buffer)
}

export async function parseVaziosManifestBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosManifest> {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'array', cellText: true, cellDates: false })
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!firstSheet) throw new Error('Arquivo sem abas validas.')

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: false })
  if (!rows.length) throw new Error('Planilha vazia.')

  const sampleRow = rows[0]
  const colMapping: Record<string, string> = {}
  for (const originalKey of Object.keys(sampleRow)) {
    const normalized = originalKey.trim().toLowerCase()
    const mapped = HEADER_MAP[normalized]
    if (mapped) colMapping[originalKey] = mapped
  }

  const bookings: ParsedVaziosBooking[] = []
  const rowErrors: ParsedVaziosManifest['rowErrors'] = []

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2
    const mapped: Record<string, unknown> = {}
    for (const [originalKey, fieldName] of Object.entries(colMapping)) {
      mapped[fieldName] = row[originalKey]
    }

    const bookingNumber = String(mapped['booking_number'] ?? '').trim()
    if (!bookingNumber) {
      rowErrors.push({ row: rowNumber, message: 'Booking ausente — linha ignorada.', raw: row })
      return
    }

    const containerNumber = String(mapped['container_number'] ?? '').trim() || null
    if (containerNumber && !/^[A-Z]{4}\d{7}$/.test(containerNumber)) {
      rowErrors.push({
        row: rowNumber,
        message: `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`,
        raw: row,
      })
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

  return { bookings, rowErrors }
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
  const { data: voyageRow, error: voyageError } = await supabase
    .from('voyages')
    .select('id')
    .eq('id', voyageId)
    .single()
  if (voyageError || !voyageRow) throw new Error('Viagem nao encontrada.')

  const { data: manifestRow, error: manifestError } = await supabase
    .from('vazios_manifests')
    .insert({
      voyage_id: voyageId,
      description: description ?? null,
      total_bookings: manifest.bookings.length,
      imported_by: uploadedBy,
    })
    .select('id')
    .single()

  if (manifestError || !manifestRow) throw manifestError ?? new Error('Falha ao criar manifesto.')

  const manifestId = manifestRow.id

  if (manifest.bookings.length) {
    const rows = manifest.bookings.map((b) => ({
      manifest_id: manifestId,
      booking_number: b.booking_number,
      container_number: b.container_number,
      container_type: b.container_type,
      movement_date: b.movement_date,
      origin_terminal: b.origin_terminal,
      destination: b.destination,
      notes: b.notes,
    }))

    const { error: insertError } = await supabase
      .from('vazios_bookings')
      .upsert(rows, { onConflict: 'manifest_id,booking_number' })
    if (insertError) throw insertError
  }

  return { manifestId }
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
    query = query.or(
      `booking_number.ilike.%${filters.search}%,container_number.ilike.%${filters.search}%`,
    )
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
