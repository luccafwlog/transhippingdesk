import { supabase } from './supabase'
import type { BaplieContainer } from './baplieParser'

/** Persiste containers do Baplie no staging. Substitui staging anterior da mesma viagem. */
export async function importBaplieStaging(
  voyageId: number,
  containers: BaplieContainer[],
  actorId?: string | null,
): Promise<{ staged: number }> {
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

  const { error } = await supabase.rpc('import_baplie_staging_transactional' as never, {
    p_voyage_id: voyageId,
    p_rows: rows,
  } as never)
  if (error) throw error

  return { staged: rows.length }
}

