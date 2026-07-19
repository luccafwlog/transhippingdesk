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

// ponytail: database.ts nao tipa portal_notifications/customer_portal_accounts;
// casts locais ate regenerar tipos com autorizacao.
export async function getBlPortalStatus(input: { blId: string; ceMercante: string | null; customerId: number | null }) {
  const [accountRes, notificationsRes, disputesRes] = await Promise.all([
    input.customerId == null
      ? Promise.resolve({ data: null, error: null })
      : (supabase.from as unknown as (t: string) => { select: (c: string) => { eq: (k: string, v: number) => { maybeSingle: () => Promise<{ data: { account_situation: string } | null; error: Error | null }> } } })('customer_portal_accounts').select('account_situation').eq('customer_id', input.customerId).maybeSingle(),
    (supabase.from as unknown as (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { order: (k: string, o: { ascending: boolean }) => { limit: (n: number) => Promise<{ data: unknown[] | null; error: Error | null }> } } } })('portal_notifications').select('id, type, title, created_at, read_at').eq('bl_id', input.blId).order('created_at', { ascending: false }).limit(10),
    supabase.from('demurrage_invoices').select('id, doc_number, dispute_open, dispute_status').eq('bl_id', input.blId).eq('dispute_open', true),
  ])
  if (accountRes.error) throw accountRes.error
  if (notificationsRes.error) throw notificationsRes.error
  if (disputesRes.error) throw disputesRes.error
  return {
    visibility: computeBlPortalVisibility({ ceMercante: input.ceMercante, customerId: input.customerId, accountSituation: accountRes.data?.account_situation ?? null }),
    notifications: (notificationsRes.data ?? []) as BlPortalNotification[],
    openDisputes: (disputesRes.data ?? []) as Array<{ id: number; doc_number: string | null; dispute_status: string | null }>,
  }
}
