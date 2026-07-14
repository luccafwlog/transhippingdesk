import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { customer_id?: number; action?: string; reason?: string }
  if (!body.customer_id || !['suspend', 'reactivate'].includes(body.action ?? '') || !body.reason?.trim()) return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 422 })
  const url = Deno.env.get('SUPABASE_URL')!; const jwt = req.headers.get('Authorization') ?? ''
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: jwt } } })
  const { data: role } = await caller.rpc('portal_current_role')
  if (!['administrativo', 'documentacao'].includes(String(role))) return new Response(JSON.stringify({ error: 'permission denied' }), { status: 403 })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, auth_user_id, provisioning_decision, account_situation').eq('customer_id', body.customer_id).single()
  if (!account) return new Response(JSON.stringify({ error: 'Cliente não encontrado.' }), { status: 404 })
  if (body.action === 'suspend') {
    if (account.auth_user_id) await admin.auth.admin.signOut(account.auth_user_id, 'global')
    await admin.from('customer_portal_accounts').update({ account_situation: 'suspenso', active: false }).eq('id', account.id)
    await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: null, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: account.account_situation, p_new_situation: 'suspenso', p_actor_type: role, p_reason: body.reason, p_request_id: null })
  } else {
    if (account.auth_user_id) await admin.auth.admin.signOut(account.auth_user_id, 'global')
    await admin.from('customer_portal_accounts').update({ account_situation: 'sem_conta', provisioning_decision: 'aguardando_analise', active: false, auth_user_id: null }).eq('id', account.id)
    await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: null, p_prev_decision: account.provisioning_decision, p_new_decision: 'aguardando_analise', p_prev_situation: account.account_situation, p_new_situation: 'sem_conta', p_actor_type: role, p_reason: body.reason, p_request_id: null })
  }
  return new Response(JSON.stringify({ situation: body.action === 'suspend' ? 'suspenso' : 'sem_conta' }), { status: 200 })
})
