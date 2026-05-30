import { assertUploadSize } from '../lib/fileGuard'
import { supabase } from './supabase'
import { escapeFilterTerm, toNumber } from '../lib/utils'
import type { VaziosImportacaoContainerListItem, VaziosImportacaoManifest } from '../types/database'

const HEADER_MAP: Record<string, string> = {
  'container': 'container_number',
  'conteiner': 'container_number',
  'contêiner': 'container_number',
  'numeração': 'container_number',
  'numeracao': 'container_number',
  'num. container': 'container_number',
  'num container': 'container_number',
  'tipo': 'container_type',
  'type': 'container_type',
  'tara': 'tare_kg',
  'tare': 'tare_kg',
  'tara (kg)': 'tare_kg',
  'tara kg': 'tare_kg',
  'tare (kg)': 'tare_kg',
  'tare kg': 'tare_kg',
}

export type ParsedVaziosImportacaoContainer = {
  rowNumber: number
  container_number: string
  container_type: string | null
  tare_kg: number | null
}

export type ParsedVaziosImportacaoManifest = {
  containers: ParsedVaziosImportacaoContainer[]
  rowErrors: { row: number; message: string; raw: unknown }[]
}

export async function parseVaziosImportacaoFile(file: File): Promise<ParsedVaziosImportacaoManifest> {
  assertUploadSize(file)
  const buffer = await file.arrayBuffer()
  return parseVaziosImportacaoBuffer(buffer)
}

async function parseVaziosImportacaoBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosImportacaoManifest> {
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

  const containers: ParsedVaziosImportacaoContainer[] = []
  const rowErrors: ParsedVaziosImportacaoManifest['rowErrors'] = []

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2
    const mapped: Record<string, unknown> = {}
    for (const [originalKey, fieldName] of Object.entries(colMapping)) {
      mapped[fieldName] = row[originalKey]
    }

    const containerNumber = String(mapped['container_number'] ?? '').trim()
    if (!containerNumber) {
      rowErrors.push({ row: rowNumber, message: 'Container ausente — linha ignorada.', raw: row })
      return
    }
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) {
      rowErrors.push({
        row: rowNumber,
        message: `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`,
        raw: row,
      })
    }

    const taraRaw = String(mapped['tare_kg'] ?? '').trim().replace(/[^\d.,]/g, '')
    const tare_kg = toNumber(taraRaw)

    containers.push({
      rowNumber,
      container_number: containerNumber,
      container_type: String(mapped['container_type'] ?? '').trim() || null,
      tare_kg,
    })
  })

  return { containers, rowErrors }
}

export type ImportVaziosImportacaoArgs = {
  manifest: ParsedVaziosImportacaoManifest
  uploadedBy: string
  voyageId: number
  description?: string
}

export async function importVaziosImportacaoManifest({
  manifest,
  uploadedBy,
  voyageId,
  description,
}: ImportVaziosImportacaoArgs): Promise<{ manifestId: string }> {
  const { data: voyageRow, error: voyageError } = await supabase
    .from('voyages')
    .select('id')
    .eq('id', voyageId)
    .single()
  if (voyageError || !voyageRow) throw new Error('Viagem nao encontrada.')

  const { data: manifestRow, error: manifestError } = await supabase
    .from('vazios_importacao_manifests')
    .insert({
      voyage_id: voyageId,
      description: description ?? null,
      total_containers: manifest.containers.length,
      imported_by: uploadedBy,
    })
    .select('id')
    .single()

  if (manifestError || !manifestRow) throw manifestError ?? new Error('Falha ao criar manifesto.')

  const manifestId = manifestRow.id

  if (manifest.containers.length) {
    const rows = manifest.containers.map((c) => ({
      manifest_id: manifestId,
      container_number: c.container_number,
      container_type: c.container_type,
      tare_kg: c.tare_kg,
    }))

    const { error: insertError } = await supabase
      .from('vazios_importacao_containers')
      .upsert(rows, { onConflict: 'manifest_id,container_number' })
    if (insertError) throw insertError
  }

  return { manifestId }
}

export async function importVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
}): Promise<{ manifestId: string; total: number }> {
  const PAGE = 1000
  let containers: { container_number: string; size_type: string | null; weight_kg: number | null; pod: string | null }[] = []
  let from = 0
  while (true) {
    const { data, error: stagedError } = await supabase
      .from('baplie_containers' as never)
      .select('container_number, size_type, weight_kg, pod')
      .eq('voyage_id', voyageId)
      .eq('status', 'empty')
      .range(from, from + PAGE - 1)
    if (stagedError) throw stagedError
    containers = containers.concat((data ?? []) as { container_number: string; size_type: string | null; weight_kg: number | null; pod: string | null }[])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  if (!containers.length) throw new Error('Nenhum container vazio encontrado no Baplie desta viagem.')

  const { data: manifestRow, error: manifestError } = await supabase
    .from('vazios_importacao_manifests')
    .insert({
      voyage_id: voyageId,
      description: description ?? 'Importado via Baplie EDI',
      total_containers: containers.length,
      imported_by: uploadedBy,
      source: 'baplie',
    } as never)
    .select('id')
    .single()

  if (manifestError || !manifestRow) throw manifestError ?? new Error('Falha ao criar manifesto.')

  const rows = containers.map((c) => ({
    manifest_id: manifestRow.id,
    container_number: c.container_number,
    container_type: c.size_type,
    tare_kg: c.weight_kg,
    pod: c.pod,
  }))

  const { error: insertError } = await supabase
    .from('vazios_importacao_containers')
    .upsert(rows, { onConflict: 'manifest_id,container_number' })
  if (insertError) throw insertError

  return { manifestId: manifestRow.id, total: containers.length }
}

export async function getBaplieManifestForVoyage(voyageId: number): Promise<{
  id: string
  total_containers: number
  imported_at: string
} | null> {
  const { data, error } = await supabase
    .from('vazios_importacao_manifests')
    .select('id, total_containers, imported_at')
    .eq('voyage_id', voyageId)
    .eq('source' as never, 'baplie')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; total_containers: number; imported_at: string } | null
}

export async function deleteBaplieManifestForVoyage(voyageId: number): Promise<void> {
  const { error } = await supabase
    .from('vazios_importacao_manifests')
    .delete()
    .eq('voyage_id', voyageId)
    .eq('source' as never, 'baplie')
  if (error) throw error
}

export async function listVaziosImportacaoContainers(filters: {
  manifestId?: string
  voyageId?: string
  search?: string
  page?: number
  pageSize?: number
}) {
  // Limita os parâmetros de paginação para evitar DoS por alocação excessiva
  // (ex.: pageSize=999999) ou offsets negativos vindos do cliente.
  const pageSize = Math.min(Math.max(Math.trunc(filters.pageSize ?? 20), 1), 200)
  const page = Math.max(Math.trunc(filters.page ?? 1), 1)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('vazios_importacao_containers')
    .select(
      `*, manifest:vazios_importacao_manifests(id, voyage_id, description, imported_at, voyage:voyages(voyage_number, vessel:vessels(name)))`,
      { count: 'exact' },
    )
    .range(from, to)
    .order('created_at', { ascending: false })

  if (filters.search) {
    // Neutraliza sintaxe do parser PostgREST e curingas do LIKE (% e _)
    const safe = escapeFilterTerm(filters.search)
    if (safe) {
      query = query.or(
        `container_number.ilike.%${safe}%,container_type.ilike.%${safe}%`,
      )
    }
  }

  if (filters.manifestId) {
    query = query.eq('manifest_id', filters.manifestId)
  }

  if (filters.voyageId) {
    const { data: manifestIds } = await supabase
      .from('vazios_importacao_manifests')
      .select('id')
      .eq('voyage_id', Number(filters.voyageId))
    const ids = (manifestIds ?? []).map((m: { id: string }) => m.id)
    if (!ids.length) return { rows: [], count: 0 }
    query = query.in('manifest_id', ids)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as unknown as VaziosImportacaoContainerListItem[], count: count ?? 0 }
}

export async function listVaziosImportacaoManifests() {
  const { data, error } = await supabase
    .from('vazios_importacao_manifests')
    .select('id, description, total_containers, imported_at')
    .order('imported_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as unknown as VaziosImportacaoManifest[]
}
