import type { ParsedManifest } from './manifestParser'
import { supabase } from './supabase'

const POL_ENTITY_TYPE = 'voyage_pol_schedule'
const POD_ENTITY_TYPE = 'voyage_pod_schedule'

export const POD_CE_STATUS_OPTIONS = [
  { value: 'waiting', label: 'Waiting' },
  { value: 'received', label: 'Received' },
  { value: 'launching', label: 'Launching' },
  { value: 'approving', label: 'Approving' },
  { value: 'approved', label: 'Approved' },
] as const

export type EditableVoyagePodCeStatus = (typeof POD_CE_STATUS_OPTIONS)[number]['value']
export type VoyagePodCeStatus = EditableVoyagePodCeStatus | 'partial' | 'missing'

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
  etb: string | null
  ata: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
}

export function getEditableVoyagePodCeStatus(status: VoyagePodCeStatus | null | undefined): EditableVoyagePodCeStatus {
  if (status === 'approved' || status === 'received' || status === 'launching' || status === 'approving') return status
  if (status === 'partial') return 'launching'
  return 'waiting'
}

export function getVoyagePodCeStatusLabel(status: VoyagePodCeStatus | null | undefined) {
  if (status === 'approved') return 'Approved'
  if (status === 'approving') return 'Approving'
  if (status === 'launching' || status === 'partial') return 'Launching'
  if (status === 'received') return 'Received'
  if (status === 'missing') return 'Missing'
  return 'Waiting'
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
  const seenFieldsByEntity = new Map<string, Set<string>>()

  for (const row of data ?? []) {
    if (row.field_name !== 'etd') continue

    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPolSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()
    if (!seenFields.has('etd')) {
      current.etd = normalizeDateValue(row.new_value)
      seenFields.add('etd')
      seenFieldsByEntity.set(entityId, seenFields)
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
    .range(0, Math.max(999, entityIds.length * 20))

  if (error) throw error

  const schedules = new Map<string, VoyagePodSchedule>()
  const seenFieldsByEntity = new Map<string, Set<string>>()

  for (const row of data ?? []) {
    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPodSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()

    if (row.field_name === 'eta' && !seenFields.has('eta')) current.eta = normalizeDateValue(row.new_value)
    if (row.field_name === 'etb' && !seenFields.has('etb')) current.etb = normalizeDateValue(row.new_value)
    if (row.field_name === 'ata' && !seenFields.has('ata')) current.ata = normalizeDateValue(row.new_value)
    if (row.field_name === 'atd' && !seenFields.has('atd')) current.atd = normalizeDateValue(row.new_value)
    if (row.field_name === 'rtw' && !seenFields.has('rtw')) current.rtw = normalizeNumberValue(row.new_value)
    if (row.field_name === 'ces' && !seenFields.has('ces')) current.ceStatus = normalizeCeStatusValue(row.new_value)
    if (row.field_name === 'linked' && !seenFields.has('linked')) current.linked = normalizeBooleanValue(row.new_value)

    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)

    schedules.set(entityId, current)
  }

  return schedules
}

export async function listVoyagePodSchedulesByVoyageIds(voyageIds: number[]) {
  if (!voyageIds.length) return new Map<string, VoyagePodSchedule>()

  const data = await listScheduleAuditRowsByVoyageIds(POD_ENTITY_TYPE, voyageIds)
  return hydratePodSchedules(data)
}

export async function syncManifestPolEtdSchedules({
  voyageId,
  manifest,
  changedBy,
}: {
  voyageId: number
  manifest: ParsedManifest
  changedBy: string
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

export async function syncManifestPodLinked({
  voyageId,
  manifest,
  changedBy,
}: {
  voyageId: number
  manifest: ParsedManifest
  changedBy: string
}) {
  const distinctPods = Array.from(new Set(manifest.bls.map((bl) => bl.pod).filter(Boolean))) as string[]
  if (!distinctPods.length) return

  const entityIds = distinctPods.map((pod) => buildVoyagePodEntityId(voyageId, pod))
  const existingSchedules = await listVoyagePodSchedules(entityIds)

  const inserts = entityIds
    .filter((entityId) => existingSchedules.has(entityId) && existingSchedules.get(entityId)?.linked !== true)
    .map((entityId) => ({
      entity_type: POD_ENTITY_TYPE,
      entity_id: entityId,
      field_name: 'linked',
      old_value: null,
      new_value: 'true',
      changed_by: changedBy,
      justification: 'POD reconciliado automaticamente ao importar manifesto',
    }))

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
  etb,
  ata,
  atd,
  rtw,
  ceStatus,
  linked,
  changedBy,
}: {
  voyageId: number
  pod: string
  eta: string | null
  etb: string | null
  ata: string | null
  atd: string | null
  rtw: number | null
  ceStatus: VoyagePodCeStatus | null
  linked: boolean | null
  changedBy: string | null
}) {
  const entityId = buildVoyagePodEntityId(voyageId, pod)
  const current = (await listVoyagePodSchedules([entityId])).get(entityId) ?? makeEmptyPodSchedule(entityId)

  const changes = [
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'eta', current.eta, eta, changedBy, 'Atualizacao manual de ETA por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'etb', current.etb, etb, changedBy, 'Atualizacao manual de ETB por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'ata', current.ata, ata, changedBy, 'Atualizacao manual de ATA por POD'),
    makeAuditRow(POD_ENTITY_TYPE, entityId, 'atd', current.atd, atd, changedBy, 'Atualizacao manual de ATD por POD'),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'rtw',
      current.rtw === null ? null : String(current.rtw),
      rtw === null ? null : String(rtw),
      changedBy,
      'Atualizacao manual de RTW por POD',
    ),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'ces',
      current.ceStatus,
      ceStatus,
      changedBy,
      'Atualizacao manual de status de CEs por POD',
    ),
    makeAuditRow(
      POD_ENTITY_TYPE,
      entityId,
      'linked',
      current.linked === null ? null : String(current.linked),
      linked === null ? null : String(linked),
      changedBy,
      'Atualizacao manual de linked por POD',
    ),
  ].filter(Boolean)

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error
}

async function listScheduleAuditRowsByVoyageIds(entityType: string, voyageIds: number[]) {
  const voyagePrefixes = voyageIds.map((voyageId) => `${voyageId}::`)
  const rows: Array<{
    entity_id: string
    field_name: string
    new_value: string | null
    changed_at: string | null
  }> = []

  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('entity_id, field_name, new_value, changed_at')
      .eq('entity_type', entityType)
      .order('changed_at', { ascending: false })
      .range(from, from + 999)

    if (error) throw error

    const batch = data ?? []
    rows.push(
      ...batch.filter((row) => voyagePrefixes.some((prefix) => row.entity_id.startsWith(prefix))),
    )

    if (batch.length < 1000) break
    from += 1000
  }

  return rows
}

function hydratePodSchedules(
  rows: Array<{
    entity_id: string
    field_name: string
    new_value: string | null
    changed_at?: string | null
  }>,
) {
  const schedules = new Map<string, VoyagePodSchedule>()
  const seenFieldsByEntity = new Map<string, Set<string>>()

  for (const row of rows) {
    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPodSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()

    if (row.field_name === 'eta' && !seenFields.has('eta')) current.eta = normalizeDateValue(row.new_value)
    if (row.field_name === 'etb' && !seenFields.has('etb')) current.etb = normalizeDateValue(row.new_value)
    if (row.field_name === 'ata' && !seenFields.has('ata')) current.ata = normalizeDateValue(row.new_value)
    if (row.field_name === 'atd' && !seenFields.has('atd')) current.atd = normalizeDateValue(row.new_value)
    if (row.field_name === 'rtw' && !seenFields.has('rtw')) current.rtw = normalizeNumberValue(row.new_value)
    if (row.field_name === 'ces' && !seenFields.has('ces')) current.ceStatus = normalizeCeStatusValue(row.new_value)
    if (row.field_name === 'linked' && !seenFields.has('linked')) current.linked = normalizeBooleanValue(row.new_value)

    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)

    schedules.set(entityId, current)
  }

  return schedules
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
    etb: null,
    ata: null,
    atd: null,
    rtw: null,
    ceStatus: null,
    linked: null,
  }
}

function makeAuditRow(
  entityType: string,
  entityId: string,
  fieldName: 'etd' | 'eta' | 'etb' | 'ata' | 'atd' | 'rtw' | 'ces' | 'linked',
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

function normalizeNumberValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeBooleanValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return null
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return null
}

function normalizeCeStatusValue(value: string | null | undefined): VoyagePodSchedule['ceStatus'] {
  const normalized = (value ?? '').trim().toLowerCase()
  if (
    normalized === 'waiting' ||
    normalized === 'received' ||
    normalized === 'launching' ||
    normalized === 'approving' ||
    normalized === 'approved' ||
    normalized === 'partial' ||
    normalized === 'missing'
  ) {
    return normalized
  }
  return null
}
