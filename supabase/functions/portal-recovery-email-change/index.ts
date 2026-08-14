import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateToken, hashToken } from '../_shared/portalToken.ts'
import { emailChangeAlertTemplate, emailChangeConfirmTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'
import { revokePortalSessions } from '../_shared/revokePortalSessions.ts'
import { withCors } from '../_shared/cors.ts'

if (typeof Deno !== 'undefined') Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { action?: string; current_password?: string; new_email?: string; token?: string }
  const url = Deno.env.get('SUPABASE_URL')!; const jwt = req.headers.get('Authorization') ?? ''; const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  if (body.action === 'request') {
    const portal = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: jwt } } })
    const { data: userData } = await portal.auth.getUser(); const authId = userData.user?.id
    if (!authId || !body.current_password || !body.new_email?.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 422 })
    const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, recovery_email, auth_user_id, customers(name, cnpj_cpf)').eq('auth_user_id', authId).single()
    const { data: authUser } = await admin.auth.admin.getUserById(authId); const technicalEmail = authUser.user?.email
    const verifier = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!)
    const verified = technicalEmail ? await verifier.auth.signInWithPassword({ email: technicalEmail, password: body.current_password }) : { error: new Error('invalid') }
    const email = body.new_email.toLowerCase(); const { data: suppressed } = await admin.from('portal_suppressed_emails').select('id').eq('email', email).maybeSingle()
    if (!account || !verified || verified.error || suppressed) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 422 })
    await admin.from('portal_invites').update({ status: 'invalidado_por_reenvio' }).eq('account_id', account.id).eq('purpose', 'confirmacao_email').eq('status', 'pendente')
    const token = generateToken(); const tokenHash = await hashToken(token)
    const { data: invite } = await admin.from('portal_invites').insert({ account_id: account.id, purpose: 'confirmacao_email', token_hash: tokenHash, sent_to_email: email, expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), status: 'pendente' }).select('id').single()
    if (!invite) return new Response(JSON.stringify({ error: 'Não foi possível iniciar a troca de email.' }), { status: 500 })
    await admin.from('customer_portal_accounts').update({ pending_recovery_email: email }).eq('id', account.id)
    const portalUrl = Deno.env.get('PORTAL_URL') ?? ''
    const supportEmail = Deno.env.get('PORTAL_SUPPORT_EMAIL') ?? 'suporte@transhippingdesk.com.br'
    // Rota publica dedicada: o link chega no Email de Recuperacao, que costuma
    // ser lido pelo contato financeiro -- sem senha do Portal. Apontar para
    // /portal/perfil (rota protegida) fazia o guard redirecionar para o login
    // descartando a query string, e o token se perdia em silencio.
    const urlConfirm = `${portalUrl}/portal/confirmar-email?token=${encodeURIComponent(token)}`
    const customer = account.customers as { name?: string } | null
    const confirmTemplate = emailChangeConfirmTemplate({ companyName: customer?.name ?? 'sua empresa', confirmUrl: urlConfirm, portalUrl, supportEmail })
    await sendPortalEmail({ admin, kind: 'alteracao_email', to: email, subject: confirmTemplate.subject, html: confirmTemplate.html, text: confirmTemplate.text, idempotencyKey: `alteracao_email:${invite.id}`, accountId: account.id, inviteId: invite.id })
    if (account.recovery_email && account.recovery_email.toLowerCase() !== email) {
      const alertTemplate = emailChangeAlertTemplate({ portalUrl, supportEmail })
      await sendPortalEmail({ admin, kind: 'alteracao_email', to: account.recovery_email, subject: alertTemplate.subject, html: alertTemplate.html, text: alertTemplate.text, idempotencyKey: `alteracao_email_alerta:${invite.id}`, accountId: account.id })
    }
    return new Response(JSON.stringify({ pending: true }), { status: 200 })
  }
  if (body.action === 'confirm' && body.token) {
    const { data: invite } = await admin.from('portal_invites').select('id, account_id, expires_at, status').eq('token_hash', await hashToken(body.token)).eq('purpose', 'confirmacao_email').maybeSingle()
    if (!invite || invite.status !== 'pendente' || new Date(invite.expires_at).getTime() <= Date.now()) return new Response(JSON.stringify({ error: 'Link inválido ou expirado.' }), { status: 410 })
    const { data: consumed } = await admin.from('portal_invites').update({ status: 'consumido', consumed_at: new Date().toISOString() }).eq('id', invite.id).eq('status', 'pendente').select('id').maybeSingle()
    if (!consumed) return new Response(JSON.stringify({ error: 'Link inválido ou expirado.' }), { status: 410 })
    const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, auth_user_id, pending_recovery_email, provisioning_decision, account_situation').eq('id', invite.account_id).single()
    if (!account?.pending_recovery_email) return new Response(JSON.stringify({ error: 'Link inválido ou expirado.' }), { status: 410 })
    await admin.from('customer_portal_accounts').update({ recovery_email: account.pending_recovery_email, pending_recovery_email: null, recovery_email_source: 'informado_manualmente' }).eq('id', account.id)
    if (account.auth_user_id) await revokePortalSessions(account.auth_user_id)
    await admin.rpc('_portal_log_event', { p_customer_id: account.customer_id, p_account_id: account.id, p_invite_id: invite.id, p_prev_decision: account.provisioning_decision, p_new_decision: account.provisioning_decision, p_prev_situation: account.account_situation, p_new_situation: account.account_situation, p_actor_type: 'cliente', p_reason: 'Email de recuperação confirmado pelo cliente; sessões anteriores encerradas', p_request_id: null })
    return new Response(JSON.stringify({ confirmed: true }), { status: 200 })
  }
  return new Response(JSON.stringify({ error: 'Dados inválidos.' }), { status: 422 })
}))
