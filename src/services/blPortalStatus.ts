import { z } from 'zod'
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

const blPortalStatusSchema = z.object({
  ce_mercante: z.string().nullable(),
  customer_id: z.number().nullable(),
  account_situation: z.string().nullable(),
  notifications: z.array(z.object({
    id: z.number(),
    type: z.string(),
    title: z.string(),
    created_at: z.string(),
    read_at: z.string().nullable(),
  })).default([]),
  open_disputes: z.array(z.object({
    id: z.number(),
    doc_number: z.string().nullable(),
    dispute_status: z.string().nullable(),
  })).default([]),
})

export async function getBlPortalStatus(input: { blId: string; ceMercante: string | null; customerId: number | null }) {
  // O Portal mantém notifications/accounts protegidas por RLS; a leitura interna
  // passa pelo RPC SECURITY DEFINER, que valida o usuário e escopa pelo B/L.
  const { data, error } = await supabase.rpc('get_bl_portal_status', { p_bl_id: input.blId })
  if (error) throw error
  const result = blPortalStatusSchema.parse(data)
  return {
    visibility: computeBlPortalVisibility({ ceMercante: result.ce_mercante, customerId: result.customer_id, accountSituation: result.account_situation }),
    notifications: result.notifications ?? [],
    openDisputes: result.open_disputes ?? [],
  }
}
