import type { ParsedManifest } from './manifestParser'
import { supabase } from './supabase'

const POL_ENTITY_TYPE = 'voyage_pol_schedule'
const POD_ENTITY_TYPE = 'voyage_pod_schedule'

export type VoyagePolSchedule = {
  entityId: string
  voyageId: number
  pol: string
  etd: string | null
}

export type VoyagePodSchedule = {
  entityId: string
  voyageId: number
  pod: string
  eta: string | null
  ata: string | null
}

export function buildVoyagePolEntityId(voyageId: number, pol: string | null | undefined) {
  return `${voyageId}::${normalizePortValue(pol)}`
}

export function buildVoyagePodEntityId(voyageId: number, pod: string | null | undefined) {
  return `${voyageId}::${normalizePortValue(pod)}`
}

export async function listVoyagePolSchedules(entityIds: string[]) {
  if (!entityIds.length) return new Map<string, VoyagePolSchedule>()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id, field_name, new_value, changed_at')
    .eq('entity_type', POL_ENTITY_TYPE)
    .in('entity_id', entityIds)
    .order('changed_at', { ascending: false })
    .range(0, Math.max(999, entityIds.length * 5))

  if (error) throw error

  const schedules = new Map<string, VoyagePolSchedule>()

  for (const row of data ?? []) {
    if (row.field_name !== 'etd') continue

    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPolSchedule(entityId)
    if (current.etd === null) {
      current.etd = normalizeDateValue(row.new_value)
    }
    schedules.set(entityId, current)
  }

  return schedules
}

export async function listVoyagePodSchedules(entityIds: string[]) {
  if (!entityIds.length) return new Map<string, VoyagePodSchedule>()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id, field_name, new_value, changed_at')
    .eq('entity_type', POD_ENTITY_TYPE)
    .in('entity_id', entityIds)
    .order('changed_at', { ascending: false })
    .range(0, Math.max(999, entityIds.length * 10))

  if (error) throw error

  const schedules = new Map<string, VoyagePodSchedule>()

  for (const row of data ?? []) {
    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPodSchedule(entityId)

    if (row.field_name === 'eta' && current.eta === null) current.eta = normalizeDateValue(row.new_value)
    if (row.field_name === 'ata' && current.ata === null) current.ata = normalizeDateValue(row.new_value)

    schedules.set(entityId, current)
  }

  return schedules
}

export async function syncManifestPolEtdSchedules({
  voyageId,
  manifest,
  changedBy,
}: {
  voyageId: number
  manifest: ParsedManifest
  changedBy: string | null
}) {
  if (!manifest.manifest_etd) return

  const entityIds = Array.from(new Set(manifest.bls.map((bl) => buildVoyagePolEntityId(voyageId, bl.pol))))
  const currentSchedules = await listVoyagePolSchedules(entityIds)

  const inserts = entityIds
    .map((entityId) => {
      const currentEtd = currentSchedules.get(entityId)?.etd ?? null
      if (currentEtd === manifest.manifest_etd) return null

      return {
        entity_type: POL_ENTITY_TYPE,
        entity_id: entityId,
        field_name: 'etd',
        old_value: currentEtd,
        new_value: manifest.manifest_etd,
        changed_by: changedBy,
        justification: 'ETD importado do manifesto por POL',
      }
    })
    .filter(Boolean)

  if (!inserts.length) return

  const { error } = await supabase.from('audit_logs').insert(inserts)
  if (error) throw error
}

export async function saveVoyagePolSchedule({
  voyageId,
  pol,
  etd,
  changedBy,
}: {
  voyageId: number
  pol: string
  etd: string | null
  changedBy: string | null
}) {
  const entityId = buildVoyagePolEntityId(voyageId, pol)
  const current = (await listVoyagePolSchedules([entityId])).get(entityId) ?? makeEmptyPolSchedule(entityId)

  const changes = [
    makeAuditRow(POL_ENTITY_TYPE, entityId, 'etd', current.etd, etd, changedBy, 'Atualizacao manual de ETD por POL'),
  ].filter(Boolean)

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error
}

export async function saveVoyagePodSchedule({
  voyageId,
  pod,
  eta,
  ata,
  changedBy,
}: {
  voyageId: number
  pod: string
  eta: string | null
  ata: string | null
  changedBy: string | null
}) {
  const entityId = buildVoyagePodEntityId(voyageId, pod)
  const current = (await listVoyagePodSchedules([entityId])).get(entityId) ?? makeEmptyPodSchedule(entityId)

  const changes = [
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'eta', current.eta, eta, changedBy, 'Atualizacao manual de ETA por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'ata', current.ata, ata, changedBy, 'Atualizacao manual de ATA por POD'),
  ].filter(Boolean)

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error
}

function makeEmptyPolSchedule(entityId: string): VoyagePolSchedule {
  const [voyageId, pol] = entityId.split('::')
  return {
    entityId,
    voyageId: Number(voyageId),
    pol: pol ?? '-',
    etd: null,
  }
}

function makeEmptyPodSchedule(entityId: string): VoyagePodSchedule {
  const [voyageId, pod] = entityId.split('::')
  return {
    entityId,
    voyageId: Number(voyageId),
    pod: pod ?? '-',
    eta: null,
    ata: null,
  }
}

function makeAuditRow(
  entityType: string,
  entityId: string,
  fieldName: 'etd' | 'eta' | 'ata',
  oldValue: string | null,
  newValue: string | null,
  changedBy: string | null,
  justification: string,
) {
  const normalizedOldValue = normalizeDateValue(oldValue)
  const normalizedNewValue = normalizeDateValue(newValue)

  if (normalizedOldValue === normalizedNewValue) return null

  return {
    entity_type: entityType,
    entity_id: entityId,
    field_name: fieldName,
    old_value: normalizedOldValue,
    new_value: normalizedNewValue,
    changed_by: changedBy,
    justification,
  }
}

function normalizePortValue(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

function normalizeDateValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  return normalized || null
}
