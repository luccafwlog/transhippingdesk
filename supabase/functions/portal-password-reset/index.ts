import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hashToken } from '../_shared/portalToken.ts'
if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { token?: string; password?: string }
  if (!body.token || typeof body.password !== 'string' || body.password.length < 8) return new Response(JSON.stringify({ error: 'Link inválido ou senha inválida.' }), { status: 422 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: invite } = await admin.from('portal_invites').select('id, account_id, expires_at, status').eq('token_hash', await hashToken(body.token)).eq('purpose', 'recuperacao').maybeSingle()
  if (!invite || invite.status !== 'pendente' || new Date(invite.expires_at).getTime() <= Date.now()) return new Response(JSON.stringify({ error: 'Link inválido ou expirado. Solicite uma nova recuperação.' }), { status: 410 })
  const { data: consumed } = await admin.from('portal_invites').update({ status: 'consumido', consumed_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'pendente').gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (!consumed) return new Response(JSON.stringify({ error: 'Link inválido ou expirado. Solicite uma nova recuperação.' }), { status: 410 })
  const { data: account } = await admin.from('customer_portal_accounts').select('auth_user_id, customer_id, provisioning_decision, account_situation').eq('id', invite.account_id).single()
  if (!account?.auth_user_id) return new Response(JSON.stringify({ error: 'Link inválido ou expirado. Solicite uma nova recuperação.' }), { status: 410 })
  const { error } = await admin.auth.admin.updateUserById(account.auth_user_id, { password: body.password })
  if (error) return new Response(JSON.stringify({ error: 'Não foi possível atualizar a senha.' }), { status: 500 })
  await admin.auth.admin.signOut(account.auth_user_id, 'global')
  await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: invite.account_id, p_invite_id: invite.id, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: account.account_situation, p_new_situation: account.account_situation, p_actor_type: 'cliente', p_reason: 'Recuperação de senha concluída pelo cliente', p_request_id: null })
  return new Response(JSON.stringify({ reset: true }), { status: 200 })
})
