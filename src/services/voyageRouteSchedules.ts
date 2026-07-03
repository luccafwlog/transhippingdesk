import type { ParsedManifest } from './manifestParser'
import { normalizePortCode } from './portCode'
import { supabase } from './supabase'

const POL_ENTITY_TYPE = 'voyage_pol_schedule'
const POD_ENTITY_TYPE = 'voyage_pod_schedule'

export const POD_CE_STATUS_OPTIONS = [
  { value: 'waiting', label: 'Aguardando' },
  { value: 'received', label: 'Recebido' },
  { value: 'launching', label: 'Lançando' },
  { value: 'approving', label: 'Em aprovação' },
  { value: 'approved', label: 'Aprovado' },
] as const

export type EditableVoyagePodCeStatus = (typeof POD_CE_STATUS_OPTIONS)[number]['value']
export type VoyagePodCeStatus = EditableVoyagePodCeStatus | 'partial' | 'missing'

export type VoyagePolSchedule = {
  entityId: string
  voyageId: number
  pol: string
  etd: string | null
  escalaNumber: string | null
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
  escalaNumber: string | null
  /** POD removido do planejamento (soft-delete via audit log). */
  deleted?: boolean
}

export function getEditableVoyagePodCeStatus(status: VoyagePodCeStatus | null | undefined): EditableVoyagePodCeStatus {
  if (status === 'approved' || status === 'received' || status === 'launching' || status === 'approving') return status
  if (status === 'partial') return 'launching'
  return 'waiting'
}

export function getVoyagePodCeStatusLabel(status: VoyagePodCeStatus | null | undefined) {
  if (status === 'approved') return 'Aprovado'
  if (status === 'approving') return 'Em aprovação'
  if (status === 'launching' || status === 'partial') return 'Lançando'
  if (status === 'received') return 'Recebido'
  if (status === 'missing') return 'Aguardando'
  return 'Aguardando'
}

export function deriveAutomaticVoyagePodCeStatus(ceFilledCount: number, blCount: number): VoyagePodCeStatus | null {
  if (blCount <= 0) return null
  if (ceFilledCount >= blCount) return 'approving'
  if (ceFilledCount > 0) return 'launching'
  return 'missing'
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
    if (row.field_name !== 'etd' && row.field_name !== 'escala_number') continue

    const entityId = row.entity_id
    const current = schedules.get(entityId) ?? makeEmptyPolSchedule(entityId)
    const seenFields = seenFieldsByEntity.get(entityId) ?? new Set<string>()
    if (row.field_name === 'etd' && !seenFields.has('etd')) {
      current.etd = normalizeDateValue(row.new_value)
    }
    if (row.field_name === 'escala_number' && !seenFields.has('escala_number')) {
      current.escalaNumber = normalizeTextValue(row.new_value)
    }
    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)
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
    if (row.field_name === 'escala_number' && !seenFields.has('escala_number')) current.escalaNumber = normalizeTextValue(row.new_value)
    if (row.field_name === 'deleted' && !seenFields.has('deleted')) current.deleted = normalizeBooleanValue(row.new_value) ?? false

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
  escalaNumber,
  changedBy,
}: {
  voyageId: number
  pol: string
  etd: string | null
  escalaNumber?: string | null
  changedBy: string | null
}) {
  const entityId = buildVoyagePolEntityId(voyageId, pol)
  const current = (await listVoyagePolSchedules([entityId])).get(entityId) ?? makeEmptyPolSchedule(entityId)

  const changes = [
    makeAuditRow(POL_ENTITY_TYPE, entityId, 'etd', current.etd, etd, changedBy, 'Atualizacao manual de ETD por POL'),
    escalaNumber === undefined
      ? null
      : makeAuditRow(POL_ENTITY_TYPE, entityId, 'escala_number', current.escalaNumber, escalaNumber, changedBy, 'Atualizacao manual de Numero de Escala por POL'),
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
  escalaNumber,
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
  escalaNumber?: string | null
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
    escalaNumber === undefined
      ? null
      : makeAuditRow(POD_ENTITY_TYPE, entityId, 'escala_number', current.escalaNumber, escalaNumber, changedBy, 'Atualizacao manual de Numero de Escala por POD'),
  ].filter(Boolean)

  // Reincluir um POD que havia sido removido: limpa o soft-delete.
  if (current.deleted) {
    changes.push({
      entity_type: POD_ENTITY_TYPE,
      entity_id: entityId,
      field_name: 'deleted',
      old_value: 'true',
      new_value: 'false',
      changed_by: changedBy,
      justification: 'Reinclusao de POD no planejamento',
    })
  }

  if (!changes.length) return

  const { error } = await supabase.from('audit_logs').insert(changes)
  if (error) throw error

  if (atd !== undefined) {
    await syncVoyageStatusAfterAtdChange(voyageId, pod, atd)
  }
}

/**
 * Remove um POD do planejamento via soft-delete (audit log field `deleted`).
 * O POD some da reconstrução (Visão geral, line-up) e o evento aparece na
 * linha do tempo. Reinserir o mesmo POD limpa o marcador.
 */
export async function deleteVoyagePodSchedule({
  voyageId,
  pod,
  changedBy,
}: {
  voyageId: number
  pod: string
  changedBy: string | null
}) {
  const entityId = buildVoyagePodEntityId(voyageId, pod)
  const { error } = await supabase.from('audit_logs').insert([
    {
      entity_type: POD_ENTITY_TYPE,
      entity_id: entityId,
      field_name: 'deleted',
      old_value: 'false',
      new_value: 'true',
      changed_by: changedBy,
      justification: 'Remocao de POD do planejamento',
    },
  ])
  if (error) throw error
}

/**
 * CE Master por ROTA (POL/POD), independente de batch de manifesto (#322).
 * Viagem só-B/L não tem batch onde guardar a CE agrupadora; aqui fica por rota.
 * A chave do mapa é `${voyageId}::${POL}__${POD}` (portos em maiúsculas).
 */
export function buildVoyageRouteCeMasterKey(
  voyageId: number,
  pol: string | null | undefined,
  pod: string | null | undefined,
) {
  return `${voyageId}::${normalizeRoutePort(pol)}__${normalizeRoutePort(pod)}`
}

export async function setVoyageRouteCeMaster({
  voyageId,
  pol,
  pod,
  ceMaster,
  changedBy,
}: {
  voyageId: number
  pol: string
  pod: string
  ceMaster: string | null
  changedBy: string
}) {
  const { error } = await supabase.rpc('set_voyage_route_ce_master' as never, {
    p_voyage_id: voyageId,
    p_pol: pol,
    p_pod: pod,
    p_ce_master: ceMaster,
    p_changed_by: changedBy,
  } as never)
  if (error) throw error
}

export async function listVoyageRouteCeMasters(voyageIds: number[]) {
  const result = new Map<string, string>()
  if (!voyageIds.length) return result

  const { data, error } = await supabase
    .from('voyage_route_ce_master' as never)
    .select('voyage_id, pol, pod, ce_master')
    .in('voyage_id', voyageIds)

  if (error) throw error

  for (const row of (data ?? []) as Array<{
    voyage_id: number
    pol: string | null
    pod: string | null
    ce_master: string | null
  }>) {
    const ce = normalizeTextValue(row.ce_master)
    if (!ce) continue
    result.set(buildVoyageRouteCeMasterKey(row.voyage_id, row.pol, row.pod), ce)
  }

  return result
}

async function syncVoyageStatusAfterAtdChange(voyageId: number, changedPod: string, newAtd: string | null) {
  const allPodSchedules = await listVoyagePodSchedulesByVoyageIds([voyageId])

  const podAtdValues: Array<{ pod: string; atd: string | null }> = []
  for (const [entityId, schedule] of allPodSchedules) {
    if (schedule.voyageId !== voyageId) continue
    const pod = entityId.split('::')[1] ?? '-'
    const atd = pod === changedPod ? newAtd : schedule.atd
    podAtdValues.push({ pod, atd })
  }

  if (podAtdValues.length === 0) return

  const allAtdSet = podAtdValues.every((entry) => entry.atd)
  const newStatus = allAtdSet ? 'completed' : 'active'

  const { data: voyage, error: fetchError } = await supabase
    .from('voyages')
    .select('status')
    .eq('id', voyageId)
    .single()

  if (fetchError || !voyage || voyage.status === newStatus) return

  const { error: updateError } = await supabase
    .from('voyages')
    .update({ status: newStatus })
    .eq('id', voyageId)

  if (updateError) throw updateError
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
    if (row.field_name === 'escala_number' && !seenFields.has('escala_number')) current.escalaNumber = normalizeTextValue(row.new_value)
    if (row.field_name === 'deleted' && !seenFields.has('deleted')) current.deleted = normalizeBooleanValue(row.new_value) ?? false

    seenFields.add(row.field_name)
    seenFieldsByEntity.set(entityId, seenFields)

    schedules.set(entityId, current)
  }

  // PODs removidos (soft-delete) somem do planejamento e dos consumidores
  // (Visão geral, line-up, status da viagem).
  for (const [entityId, schedule] of schedules) {
    if (schedule.deleted) schedules.delete(entityId)
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
    escalaNumber: null,
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
    escalaNumber: null,
    deleted: false,
  }
}

function makeAuditRow(
  entityType: string,
  entityId: string,
  fieldName: 'etd' | 'eta' | 'etb' | 'ata' | 'atd' | 'rtw' | 'ces' | 'linked' | 'escala_number' | 'deleted',
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
  return normalizePortCode(value) ?? '-'
}

function normalizeRoutePort(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase() || '-'
}

function normalizeDateValue(value: string | null | undefined) {
  const normalized = (value ?? '').trim()
  return normalized || null
}

function normalizeTextValue(value: string | null | undefined) {
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
