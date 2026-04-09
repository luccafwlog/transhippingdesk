import { supabase } from './supabase'
import type { ParsedManifest } from './manifestParser'

const ENTITY_TYPE = 'voyage_route_schedule'

export type VoyageRouteSchedule = {
  entityId: string
  voyageId: number
  pol: string
  pod: string
  etd: string | null
  eta: string | null
  ata: string | null
}

export function buildVoyageRouteEntityId(voyageId: number, pol: string | null | undefined, pod: string | null | undefined) {
  return `${voyageId}::${normalizePortValue(pol)}::${normalizePortValue(pod)}`
}

export async function listVoyageRouteSchedules(routeEntityIds: string[]) {
  if (!routeEntityIds.length) return new Map<string, VoyageRouteSchedule>()

  const { data, error } = await supabase
    .from('audit_logs')
    .select('entity_id, field_name, new_value, changed_at')
    .eq('entity_type', ENTITY_TYPE)
    .in('entity_id', routeEntityIds)
    .order('changed_at', { ascending: false })
    .range(0, Math.max(999, routeEntityIds.length * 10))

  if (error) throw error

  const schedules = new Map<string, VoyageRouteSchedule>()

  for (const row of data ?? []) {
    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptySchedule(entityId)

    if (row.field_name === 'etd' && current.etd === null) current.etd = normalizeDateValue(row.new_value)
    if (row.field_name === 'eta' && current.eta === null) current.eta = normalizeDateValue(row.new_value)
    if (row.field_name === 'ata' && current.ata === null) current.ata = normalizeDateValue(row.new_value)

    schedules.set(entityId, current)
  }

  return schedules
}

export async function syncManifestRouteEtdSchedules({
  voyageId,
  manifest,
  changedBy,
}: {
  voyageId: number
  manifest: ParsedManifest
  changedBy: string | null
}) {
  if (!manifest.manifest_etd) return

  const routeEntityIds = Array.from(
    new Set(manifest.bls.map((bl) => buildVoyageRouteEntityId(voyageId, bl.pol, bl.pod))),
  )
  const currentSchedules = await listVoyageRouteSchedules(routeEntityIds)

  const inserts = routeEntityIds
    .map((entityId) => {
      const currentEtd = currentSchedules.get(entityId)?.etd ?? null
      if (currentEtd === manifest.manifest_etd) return null

      return {
        entity_type: ENTITY_TYPE,
        entity_id: entityId,
        field_name: 'etd',
        old_value: currentEtd,
        new_value: manifest.manifest_etd,
        changed_by: changedBy,
        justification: 'ETD importado do manifesto',
      }
    })
    .filter(Boolean)

  if (!inserts.length) return

  const { error } = await supabase.from('audit_logs').insert(inserts)
  if (error) throw error
}

export async function saveVoyageRouteSchedule({
  voyageId,
  pol,
  pod,
  eta,
  ata,
  changedBy,
}: {
  voyageId: number
  pol: string
  pod: string
  eta: string | null
  ata: string | null
  changedBy: string | null
}) {
  const entityId = buildVoyageRouteEntityId(voyageId, pol, pod)
  const current = (await listVoyageRouteSchedules([entityId])).get(entityId) ?? makeEmptySchedule(entityId)

  const changes = [
    makeScheduleAuditRow(entityId, 'eta', current.eta, eta, changedBy),
    makeScheduleAuditRow(entityId, 'ata', current.ata, ata, changedBy),
  ].filter(Boolean)

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error
}

function makeEmptySchedule(entityId: string): VoyageRouteSchedule {
  const [voyageId, pol, pod] = entityId.split('::')
  return {
    entityId,
    voyageId: Number(voyageId),
    pol: pol ?? '-',
    pod: pod ?? '-',
    etd: null,
    eta: null,
    ata: null,
  }
}

function makeScheduleAuditRow(
  entityId: string,
  fieldName: 'eta' | 'ata',
  oldValue: string | null,
  newValue: string | null,
  changedBy: string | null,
) {
  const normalizedOldValue = normalizeDateValue(oldValue)
  const normalizedNewValue = normalizeDateValue(newValue)

  if (normalizedOldValue === normalizedNewValue) return null

  return {
    entity_type: ENTITY_TYPE,
    entity_id: entityId,
    field_name: fieldName,
    old_value: normalizedOldValue,
    new_value: normalizedNewValue,
    changed_by: changedBy,
    justification: `Atualizacao manual de ${fieldName.toUpperCase()} por trecho`,
  }
}

function normalizePortValue(value: string | null | undefined) {
  return (value ?? '').trim().toUpperCase() || '-'
}

function normalizeDateValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  return normalized || null
}
