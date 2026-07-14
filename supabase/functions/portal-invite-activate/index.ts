import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashToken } from '../_shared/portalToken.ts'

const GENERIC_INVALID = 'Link inválido ou expirado. Solicite um novo convite à empresa.'
const cors = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } })
const maskCnpj = (value: string) => { const d = value.replace(/\D/g, ''); return d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}` : '***' }

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(204, null)
  if (req.method !== 'POST') return cors(405, { error: 'Method not allowed' })
  const body = await req.json().catch(() => ({})) as { action?: string; token?: string; password?: string }
  if (!body.token) return cors(400, { error: GENERIC_INVALID })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tokenHash = await hashToken(body.token)
  const { data: invite } = await admin.from('portal_invites').select('id, account_id, status, expires_at, sent_to_email').eq('token_hash', tokenHash).eq('purpose', 'convite').maybeSingle()
  const valid = Boolean(invite && invite.status === 'pendente' && new Date(invite.expires_at).getTime() > Date.now())
  if (body.action === 'inspect') {
    if (!valid) return cors(410, { error: GENERIC_INVALID })
    const { data: account } = await admin.from('customer_portal_accounts').select('login_cnpj, customers(name)').eq('id', invite.account_id).single()
    const customer = account?.customers as { name?: string } | null
    return cors(200, { company_name: customer?.name ?? '', cnpj_masked: maskCnpj(account?.login_cnpj ?? '') })
  }
  if (body.action !== 'activate' || typeof body.password !== 'string') return cors(400, { error: GENERIC_INVALID })
  if (body.password.length < 8) return cors(422, { error: 'A senha deve ter pelo menos 8 caracteres.' })
  if (!valid) return cors(410, { error: GENERIC_INVALID })
  const { data: consumed } = await admin.from('portal_invites').update({ status: 'consumido', consumed_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'pendente').gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (!consumed) return cors(410, { error: GENERIC_INVALID })
  const technicalEmail = `p-${crypto.randomUUID()}@${Deno.env.get('PORTAL_TECH_EMAIL_DOMAIN') ?? 'portal-interno.transhippingdesk.invalid'}`
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email: technicalEmail, password: body.password, email_confirm: true })
  if (createError || !created.user) {
    await admin.from('portal_invites').update({ status: 'pendente', consumed_at: null }).eq('id', invite.id)
    return cors(500, { error: 'Não foi possível ativar. Tente novamente.' })
  }
  const { data: account } = await admin.from('customer_portal_accounts').update({ auth_user_id: created.user.id, active: true, account_situation: 'ativo' }).eq('id', invite.account_id).select('customer_id, provisioning_decision, account_situation').single()
  if (account) await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: invite.account_id, p_invite_id: invite.id, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: 'convite_pendente', p_new_situation: 'ativo', p_actor_type: 'cliente', p_reason: 'Ativação concluída pelo cliente', p_request_id: null })
  if (account) await admin.from('alerts').update({ status: 'closed', closed_at: new Date().toISOString() }).in('type', ['portal_pendencia_geral', 'portal_convite_expirado']).eq('entity_type', 'customer').eq('entity_id', String(account.customer_id)).neq('status', 'closed')
  return cors(200, { activated: true })
})
