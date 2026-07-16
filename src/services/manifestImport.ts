import { supabase } from './supabase'

/**
 * Define o CE Master (Sistema Mercante) de um manifesto. Editado inline na
 * página Viagens; operador ativo pode atualizar (RLS de import_batches).
 */
export async function setImportBatchCeMaster(batchId: number, ceMaster: string | null, changedBy: string | null) {
  const normalized = (ceMaster ?? '').trim() || null
  const { error } = await supabase.rpc('set_import_batch_ce_master', {
    p_batch_id: batchId,
    p_ce_master: normalized,
    p_changed_by: changedBy,
  })
  if (error) throw error
}
