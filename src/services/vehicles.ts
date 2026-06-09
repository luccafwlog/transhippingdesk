import { supabase } from './supabase'

/**
 * Exclui veiculos por id. Veiculo e folha no grafo de FKs (nada o referencia),
 * entao a exclusao e direta. Aceita exclusao singular (`[id]`) ou em massa.
 */
export async function deleteVehicles(ids: number[]) {
  if (ids.length === 0) return

  const { error } = await supabase.from('vehicles').delete().in('id', ids)
  if (error) throw error
}
