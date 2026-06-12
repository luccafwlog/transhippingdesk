import { supabase } from './supabase'
import type { BLContainer, BaplieContainer as BaplieContainerRow } from '../types/database'

export type AttributeDivergence = {
  field: 'is_imo' | 'imo_class' | 'un_number'
  baplie_value: string | boolean | null
  manifest_value: string | boolean | null
}

export type BaplieReconciliationItem =
  | {
      kind: 'missing_in_manifest'
      container_number: string
      baplie_bl_ref: string | null
      slot: string | null
    }
  | {
      kind: 'attribute_divergence'
      container_number: string
      bl_container_id: number
      bl_number: string | null
      baplie_bl_ref: string | null
      divergences: AttributeDivergence[]
    }

export type BaplieReconciliationResult = {
  items: BaplieReconciliationItem[]
}

export async function reconcileBaplieWithManifest(voyageId: number): Promise<BaplieReconciliationResult> {
  const { data: blRows, error: blError } = await supabase
    .from('bls')
    .select('id')
    .eq('voyage_id', voyageId)
  if (blError) throw blError

  const PAGE = 1000

  const staged: BaplieContainerRow[] = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('baplie_containers' as never)
      .select('*')
      .eq('voyage_id', voyageId)
      .range(from, from + PAGE - 1)
    if (error) throw error
    staged.push(...((data ?? []) as BaplieContainerRow[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  if (!staged.length) return { items: [] }

  const blIds = (blRows ?? []).map((b) => b.id)

  const blContainers: Pick<BLContainer, 'id' | 'bl_id' | 'container_number' | 'is_imo' | 'imo_class' | 'un_number'>[] = []
  if (blIds.length) {
    let fromC = 0
    while (true) {
      const { data, error } = await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, is_imo, imo_class, un_number')
        .in('bl_id', blIds)
        .range(fromC, fromC + PAGE - 1)
      if (error) throw error
      blContainers.push(...((data ?? []) as typeof blContainers))
      if (!data || data.length < PAGE) break
      fromC += PAGE
    }
  }

  const manifestResolutionKeys = await fetchManifestResolutionKeys(
    voyageId,
    blContainers.map((container) => container.id),
  )

  const manifestByNumber = new Map<string, NonNullable<typeof blContainers>>()
  for (const c of blContainers ?? []) {
    const key = normalizeContainerNumber(c.container_number)
    const list = manifestByNumber.get(key) ?? []
    list.push(c)
    manifestByNumber.set(key, list)
  }

  const items: BaplieReconciliationItem[] = []

  for (const baplieC of staged) {
    if (baplieC.status === 'empty') continue

    const key = normalizeContainerNumber(baplieC.container_number)
    const matches = manifestByNumber.get(key)

    if (!matches?.length) {
      items.push({
        kind: 'missing_in_manifest',
        container_number: baplieC.container_number,
        baplie_bl_ref: baplieC.bl_ref,
        slot: baplieC.slot,
      })
      continue
    }

    if (matches.length > 1) continue

    for (const mc of matches) {
      const divergences: AttributeDivergence[] = []

      addDivergenceIfOpen(divergences, manifestResolutionKeys, mc.id, {
        field: 'is_imo',
        baplie_value: baplieC.is_imo,
        manifest_value: Boolean(mc.is_imo),
      }, Boolean(baplieC.is_imo) !== Boolean(mc.is_imo))

      addDivergenceIfOpen(divergences, manifestResolutionKeys, mc.id, {
        field: 'imo_class',
        baplie_value: baplieC.imo_class,
        manifest_value: mc.imo_class,
      }, Boolean(baplieC.is_imo) && normalizeVal(baplieC.imo_class) !== normalizeVal(mc.imo_class))

      addDivergenceIfOpen(divergences, manifestResolutionKeys, mc.id, {
        field: 'un_number',
        baplie_value: baplieC.un_number,
        manifest_value: mc.un_number,
      }, Boolean(baplieC.is_imo) && normalizeVal(baplieC.un_number) !== normalizeVal(mc.un_number))

      if (divergences.length > 0) {
        items.push({
          kind: 'attribute_divergence',
          container_number: baplieC.container_number,
          bl_container_id: mc.id,
          bl_number: mc.bl_id as string,
          baplie_bl_ref: baplieC.bl_ref,
          divergences,
        })
      }
    }
  }

  return { items }
}

export async function applyBaplieAttribute(
  blContainerId: number,
  field: AttributeDivergence['field'],
  value: string | boolean | null,
  actorId: string | null,
): Promise<void> {
  const update: Partial<BLContainer> = {}

  if (field === 'is_imo') update.is_imo = value as boolean
  else if (field === 'imo_class') update.imo_class = value as string | null
  else if (field === 'un_number') update.un_number = value as string | null

  const { error } = await supabase.from('bl_containers').update(update).eq('id', blContainerId)
  if (error) throw error

  await supabase.from('audit_logs').insert({
    entity_type: 'bl_container',
    entity_id: String(blContainerId),
    field_name: field,
    old_value: null,
    new_value: String(value),
    changed_by: actorId,
    changed_at: new Date().toISOString(),
    justification: 'Operador aceitou valor do Baplie via modal de reconciliacao',
  })
}

export async function keepManifestAttribute({
  voyageId,
  blContainerId,
  field,
  baplieValue,
  manifestValue,
  actorId,
}: {
  voyageId: number
  blContainerId: number
  field: AttributeDivergence['field']
  baplieValue: string | boolean | null
  manifestValue: string | boolean | null
  actorId: string | null
}): Promise<void> {
  const payload = {
    voyage_id: voyageId,
    bl_container_id: blContainerId,
    field_name: field,
    baplie_value: serializeResolutionValue(baplieValue),
    manifest_value: serializeResolutionValue(manifestValue),
    resolution: 'manifest',
    resolved_by: actorId,
  }

  const { error } = await supabase
    .from('baplie_reconciliation_resolutions' as never)
    .upsert(payload as never, {
      onConflict: 'voyage_id,bl_container_id,field_name,baplie_value,manifest_value,resolution',
    })
  if (error) throw error

  const { error: auditError } = await supabase.from('audit_logs').insert({
    entity_type: 'bl_container',
    entity_id: String(blContainerId),
    field_name: field,
    old_value: payload.baplie_value,
    new_value: payload.manifest_value,
    changed_by: actorId,
    changed_at: new Date().toISOString(),
    justification: 'Operador manteve valor do Manifesto via reconciliacao Baplie',
  })
  if (auditError) throw auditError
}

function normalizeVal(v: string | null | undefined) {
  return (v ?? '').toUpperCase()
}

function normalizeContainerNumber(v: string | null | undefined) {
  return (v ?? '').replace(/\s+/g, '').toUpperCase()
}

async function fetchManifestResolutionKeys(voyageId: number, blContainerIds: number[]) {
  if (!blContainerIds.length) return new Set<string>()

  const { data, error } = await supabase
    .from('baplie_reconciliation_resolutions' as never)
    .select('bl_container_id, field_name, baplie_value, manifest_value')
    .eq('voyage_id', voyageId)
    .eq('resolution', 'manifest')
    .in('bl_container_id', blContainerIds)
  if (error) throw error

  return new Set(
    ((data ?? []) as Array<{
      bl_container_id: number
      field_name: AttributeDivergence['field']
      baplie_value: string
      manifest_value: string
    }>).map((row) =>
      makeResolutionKey(row.bl_container_id, row.field_name, row.baplie_value, row.manifest_value),
    ),
  )
}

function addDivergenceIfOpen(
  divergences: AttributeDivergence[],
  manifestResolutionKeys: Set<string>,
  blContainerId: number,
  divergence: AttributeDivergence,
  isDivergent: boolean,
) {
  if (!isDivergent) return
  const key = makeResolutionKey(
    blContainerId,
    divergence.field,
    serializeResolutionValue(divergence.baplie_value),
    serializeResolutionValue(divergence.manifest_value),
  )
  if (!manifestResolutionKeys.has(key)) divergences.push(divergence)
}

function makeResolutionKey(
  blContainerId: number,
  field: AttributeDivergence['field'],
  baplieValue: string,
  manifestValue: string,
) {
  return `${blContainerId}:${field}:${baplieValue}:${manifestValue}`
}

function serializeResolutionValue(value: string | boolean | null) {
  return JSON.stringify(value ?? null)
}
