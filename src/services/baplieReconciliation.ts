import { supabase } from './supabase'

export type AttributeDivergence = {
  field: 'status' | 'is_imo' | 'imo_class' | 'un_number' | 'is_oog'
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
  const [{ data: staged, error: stagedError }, { data: blRows, error: blError }] = await Promise.all([
    supabase.from('baplie_containers').select('*').eq('voyage_id', voyageId),
    supabase.from('bls').select('id, bl_number').eq('voyage_id', voyageId),
  ])

  if (stagedError) throw stagedError
  if (blError) throw blError

  if (!staged?.length) return { items: [] }

  const blIds = (blRows ?? []).map((b) => b.id)
  const blById = new Map((blRows ?? []).map((b) => [b.id, b]))

  const { data: blContainers, error: containerError } = blIds.length
    ? await supabase
        .from('bl_containers')
        .select('id, bl_id, container_number, is_imo, imo_class, un_number, is_oog')
        .in('bl_id', blIds)
    : { data: [], error: null }

  if (containerError) throw containerError

  const manifestByNumber = new Map<string, typeof blContainers>()
  for (const c of blContainers ?? []) {
    const key = c.container_number.replace(/\s+/g, '').toUpperCase()
    const list = manifestByNumber.get(key) ?? []
    list.push(c)
    manifestByNumber.set(key, list)
  }

  const items: BaplieReconciliationItem[] = []

  for (const baplieC of staged) {
    const key = baplieC.container_number.toUpperCase()
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

    for (const mc of matches) {
      const divergences: AttributeDivergence[] = []

      if (baplieC.status !== null && baplieC.status !== undefined) {
        // bl_containers doesn't have a status field yet — skip for now
      }

      if (Boolean(baplieC.is_imo) !== Boolean(mc.is_imo)) {
        divergences.push({ field: 'is_imo', baplie_value: baplieC.is_imo, manifest_value: Boolean(mc.is_imo) })
      }

      if (Boolean(baplieC.is_oog) !== Boolean(mc.is_oog)) {
        divergences.push({ field: 'is_oog', baplie_value: baplieC.is_oog, manifest_value: Boolean(mc.is_oog) })
      }

      if (baplieC.is_imo && normalizeVal(baplieC.imo_class) !== normalizeVal(mc.imo_class)) {
        divergences.push({ field: 'imo_class', baplie_value: baplieC.imo_class, manifest_value: mc.imo_class })
      }

      if (baplieC.is_imo && normalizeVal(baplieC.un_number) !== normalizeVal(mc.un_number)) {
        divergences.push({ field: 'un_number', baplie_value: baplieC.un_number, manifest_value: mc.un_number })
      }

      const bl = blById.get(mc.bl_id)
      const blRef = baplieC.bl_ref
      const blNumber = bl?.bl_number ?? null
      const blRefDiverges = blRef && blNumber && normalizeVal(blRef) !== normalizeVal(blNumber)

      if (divergences.length > 0 || blRefDiverges) {
        items.push({
          kind: 'attribute_divergence',
          container_number: baplieC.container_number,
          bl_container_id: mc.id,
          bl_number: blNumber,
          baplie_bl_ref: blRef,
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
  const update: Record<string, unknown> = {}

  if (field === 'is_imo') update.is_imo = value
  else if (field === 'is_oog') update.is_oog = value
  else if (field === 'imo_class') update.imo_class = value
  else if (field === 'un_number') update.un_number = value

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

function normalizeVal(v: string | null | undefined) {
  return (v ?? '').toUpperCase()
}
