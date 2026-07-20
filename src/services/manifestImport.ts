import { supabase } from './supabase'

/**
 * Define o CE Master (Sistema Mercante) de um manifesto. Editado inline na
 * página Viagens; operador ativo pode atualizar (RLS de import_batches).
 */
export async function setImportBatchCeMaster(batchId: number, ceMaster: string | null, changedBy: string) {
  // A função normaliza string vazia e NULL da mesma forma (NULLIF/btrim).
  const normalized = (ceMaster ?? '').trim()
  const { error } = await supabase.rpc('set_import_batch_ce_master', {
    p_batch_id: batchId,
    p_ce_master: normalized,
    p_changed_by: changedBy,
  })
  if (error) throw error
}
