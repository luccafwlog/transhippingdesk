import { supabase } from './supabase'

export type BlPortalVisibility = { visible: boolean; reasons: string[] }

export function computeBlPortalVisibility(input: { ceMercante: string | null; customerId: number | null; accountSituation: string | null }): BlPortalVisibility {
  const reasons: string[] = []
  if (!input.ceMercante) reasons.push('Sem CE Mercante')
  if (input.customerId == null) reasons.push('Sem cliente vinculado')
  if (input.accountSituation !== 'ativo') reasons.push('Cliente sem Conta de Portal ativa')
  return { visible: reasons.length === 0, reasons }
}

export type BlPortalNotification = { id: number; type: string; title: string; created_at: string; read_at: string | null }

export async function getBlPortalStatus(input: { blId: string; ceMercante: string | null; customerId: number | null }) {
  // O Portal mantém notifications/accounts protegidas por RLS; a leitura interna
  // passa pelo RPC SECURITY DEFINER, que valida o usuário e escopa pelo B/L.
  const rpc = supabase.rpc as unknown as (name: string, args: { p_bl_id: string }) => Promise<{ data: unknown; error: Error | null }>
  const { data, error } = await rpc('get_bl_portal_status', { p_bl_id: input.blId })
  if (error) throw error
  const result = data as {
    ce_mercante: string | null
    customer_id: number | null
    account_situation: string | null
    notifications: BlPortalNotification[]
    open_disputes: Array<{ id: number; doc_number: string | null; dispute_status: string | null }>
  }
  return {
    visibility: computeBlPortalVisibility({ ceMercante: result.ce_mercante, customerId: result.customer_id, accountSituation: result.account_situation }),
    notifications: result.notifications ?? [],
    openDisputes: result.open_disputes ?? [],
  }
}
