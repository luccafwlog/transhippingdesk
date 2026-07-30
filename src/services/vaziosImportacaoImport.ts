import { assertUploadFile } from '../lib/fileGuard'
import { createHeaderMapper, createRowErrorCollector, readFirstSheetRows, type RowError } from './importCore'
import { supabase } from './supabase'
import { escapeFilterTerm, toNumber } from '../lib/utils'
import type { VaziosImportacaoContainerListItem, VaziosImportacaoManifest } from '../types/database'

const HEADER_MAP: Record<string, string> = {
  'container': 'container_number',
  'conteiner': 'container_number',
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

type ParsedVaziosImportacaoContainer = {
  rowNumber: number
  container_number: string
  container_type: string | null
  tare_kg: number | null
}

export type ParsedVaziosImportacaoManifest = {
  containers: ParsedVaziosImportacaoContainer[]
  rowErrors: RowError[]
}

export async function parseVaziosImportacaoFile(file: File): Promise<ParsedVaziosImportacaoManifest> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  return parseVaziosImportacaoBuffer(buffer)
}

export async function parseVaziosImportacaoBuffer(buffer: ArrayBuffer): Promise<ParsedVaziosImportacaoManifest> {
  const rows = await readFirstSheetRows(buffer)
  const mapRow = createHeaderMapper(rows[0], HEADER_MAP)

  const containers: ParsedVaziosImportacaoContainer[] = []
  const rowErrors = createRowErrorCollector()

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2
    const mapped = mapRow(row)

    const containerNumber = String(mapped['container_number'] ?? '').trim()
    if (!containerNumber) {
      rowErrors.add(rowNumber, 'Container ausente — linha ignorada.', row)
      return
    }
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) {
      rowErrors.add(rowNumber, `Container ${containerNumber}: formato ISO esperado (XXXX0000000).`, row)
    }

    const taraRaw = String(mapped['tare_kg'] ?? '').trim().replace(/[^\d.,]/g, '')
    const normalizedTara = /^\d{1,3}\.\d{3}$/.test(taraRaw) ? taraRaw.replace('.', '') : taraRaw
    const tare_kg = toNumber(normalizedTara) ?? 0

    containers.push({
      rowNumber,
      container_number: containerNumber,
      container_type: String(mapped['container_type'] ?? '').trim() || null,
      tare_kg,
    })
  })

  return { containers, rowErrors: rowErrors.errors }
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
  const containers = manifest.containers.map((container) => ({
    container_number: container.container_number,
    container_type: container.container_type,
    tare_kg: container.tare_kg,
  }))
  const { data, error } = await supabase.rpc('import_vazios_importacao_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_containers: containers,
  })
  if (error) throw error
  const result = data as { manifest_id: string }
  return { manifestId: result.manifest_id }
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
  return persistVaziosFromBaplie({ voyageId, uploadedBy, description, replaceExisting: false })
}

export async function replaceVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
}): Promise<{ manifestId: string; total: number }> {
  return persistVaziosFromBaplie({ voyageId, uploadedBy, description, replaceExisting: true })
}

async function persistVaziosFromBaplie({
  voyageId,
  uploadedBy,
  description,
  replaceExisting,
}: {
  voyageId: number
  uploadedBy: string
  description?: string
  replaceExisting: boolean
}): Promise<{ manifestId: string; total: number }> {
  const { data, error } = await supabase.rpc('replace_vazios_from_baplie_transactional', {
    p_voyage_id: voyageId,
    p_description: description ?? null,
    p_uploaded_by: uploadedBy,
    p_replace_existing: replaceExisting,
  })
  if (error) throw error
  const result = data as { manifest_id: string; total: number }
  return { manifestId: result.manifest_id, total: result.total }
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
    .eq('source', 'baplie')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as { id: string; total_containers: number; imported_at: string } | null
}

// DELETE direto na tabela é admin-only (migration 20260610170000); o
// reimport de operadores passa pela RPC escopada, que apaga apenas o
// manifesto baplie da viagem (containers caem por cascade).
export async function deleteBaplieManifestForVoyage(voyageId: number): Promise<void> {
  const { error } = await supabase.rpc('delete_baplie_manifest_for_voyage', {
    p_voyage_id: voyageId,
  })
  if (error) throw error
}

export async function listVaziosImportacaoContainers(filters: {
  manifestId?: string
  voyageId?: string
  pod?: string
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

  if (filters.pod) {
    const safe = escapeFilterTerm(filters.pod)
    if (safe) {
      query = query.ilike('pod', safe)
    }
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
