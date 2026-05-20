import { supabase } from './supabase'
import type { BaplieContainer } from './baplieParser'

export type BaplieImportResult = {
  staged: number
  updated: number
  unchanged: number
  missing: number
}

/** Persiste containers do Baplie no staging. Substitui staging anterior da mesma viagem. */
export async function importBaplieStaging(
  voyageId: number,
  containers: BaplieContainer[],
  actorId?: string | null,
): Promise<{ staged: number }> {
  const { error: deleteError } = await supabase
    .from('baplie_containers' as never)
    .delete()
    .eq('voyage_id', voyageId)

  if (deleteError) throw deleteError

  if (!containers.length) return { staged: 0 }

  const rows = containers.map((c) => ({
    voyage_id: voyageId,
    container_number: c.container_number,
    size_type: c.size_type,
    status: c.status,
    weight_kg: c.weight_kg,
    pol: c.pol,
    pod: c.pod,
    final_dest: c.final_dest,
    bl_ref: c.bl_ref,
    slot: c.slot,
    is_imo: c.is_imo,
    imo_class: c.imo_class,
    un_number: c.un_number,
    is_oog: c.is_oog,
    imported_by: actorId ?? null,
  }))

  const { error: insertError } = await supabase.from('baplie_containers' as never).insert(rows as never)
  if (insertError) throw insertError

  return { staged: rows.length }
}

/** Aplica flags IMO/OOG do Baplie em bl_containers já existentes (fluxo retroativo: manifesto importado antes do Baplie). */
export async function importBaplieFlags(
  voyageId: number,
  containers: BaplieContainer[],
  actorId?: string | null,
): Promise<BaplieImportResult> {
  if (!containers.length) return { updated: 0, unchanged: 0, missing: 0, staged: 0 }

  const { data: blRows, error: blError } = await supabase
    .from('bls')
    .select('id')
    .eq('voyage_id', voyageId)

  if (blError) throw blError

  const blIds = (blRows ?? []).map((r) => r.id)
  if (!blIds.length) return { updated: 0, unchanged: 0, missing: containers.length, staged: 0 }

  const { data: existingContainers, error } = await supabase
    .from('bl_containers')
    .select('id, bl_id, container_number, is_imo, imo_class, un_number, is_oog')
    .in('bl_id', blIds)

  if (error) throw error

  const byNumber = new Map<string, typeof existingContainers>()
  for (const c of existingContainers ?? []) {
    const key = c.container_number.replace(/\s+/g, '').toUpperCase()
    const list = byNumber.get(key) ?? []
    list.push(c)
    byNumber.set(key, list)
  }

  let updated = 0
  let unchanged = 0
  let missing = 0

  const auditEntries: {
    entity_type: string
    entity_id: string
    field_name: string
    old_value: string
    new_value: string
    changed_by: string | null
    changed_at: string
    justification: string
  }[] = []

  const now = new Date().toISOString()

  for (const baplieC of containers) {
    const key = baplieC.container_number.toUpperCase()
    const matches = byNumber.get(key)

    if (!matches?.length) {
      missing += 1
      continue
    }

    const toUpdate = matches.filter(
      (c) =>
        Boolean(c.is_imo) !== baplieC.is_imo ||
        Boolean(c.is_oog) !== baplieC.is_oog ||
        normalizeVal(c.imo_class) !== normalizeVal(baplieC.imo_class) ||
        normalizeVal(c.un_number) !== normalizeVal(baplieC.un_number),
    )

    if (!toUpdate.length) {
      unchanged += 1
      continue
    }

    const ids = toUpdate.map((c) => c.id)
    const { error: updateError } = await supabase
      .from('bl_containers')
      .update({
        is_imo: baplieC.is_imo,
        imo_class: baplieC.is_imo ? baplieC.imo_class : null,
        un_number: baplieC.is_imo ? baplieC.un_number : null,
        is_oog: baplieC.is_oog,
      })
      .in('id', ids)

    if (updateError) throw updateError

    for (const c of toUpdate) {
      auditEntries.push({
        entity_type: 'bl_container',
        entity_id: String(c.id),
        field_name: 'imo_oog_flags',
        old_value: JSON.stringify({ is_imo: Boolean(c.is_imo), imo_class: c.imo_class, un_number: c.un_number, is_oog: Boolean(c.is_oog) }),
        new_value: JSON.stringify({ is_imo: baplieC.is_imo, imo_class: baplieC.is_imo ? baplieC.imo_class : null, un_number: baplieC.is_imo ? baplieC.un_number : null, is_oog: baplieC.is_oog }),
        changed_by: actorId ?? null,
        changed_at: now,
        justification: 'Importacao de flags IMO/OOG via Baplie EDI',
      })
    }

    updated += 1
  }

  if (auditEntries.length > 0) {
    await supabase.from('audit_logs').insert(auditEntries)
  }

  return { updated, unchanged, missing, staged: 0 }
}

function normalizeVal(v: string | null | undefined) {
  return (v ?? '').toUpperCase()
}
