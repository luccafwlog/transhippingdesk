import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateToken, hashToken } from '../_shared/portalToken.ts'
import { recoveryTemplate } from '../_shared/portalEmailTemplates.ts'
import { sendPortalEmail } from '../_shared/portalEmail.ts'

const MESSAGE = 'Se houver uma conta ativa para este CNPJ, enviaremos instruções de recuperação.'
if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  const body = await req.json().catch(() => ({})) as { cnpj?: string }
  const cnpj = body.cnpj?.replace(/\D/g, '') ?? ''
  const response = () => new Response(JSON.stringify({ message: MESSAGE }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (cnpj.length !== 14) return response()
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: blocked } = await admin.rpc('portal_login_check_rate_limit', { p_login: cnpj })
  if (blocked === true) return response()
  await admin.rpc('portal_login_register_failure', { p_login: cnpj })
  const { data: account } = await admin.from('customer_portal_accounts').select('id, customer_id, account_situation, recovery_email, customers(name, cnpj_cpf)').eq('login_cnpj', cnpj).maybeSingle()
  if (!account || account.account_situation !== 'ativo' || !account.recovery_email) return response()
  const { data: suppressed } = await admin.from('portal_suppressed_emails').select('id').eq('email', account.recovery_email.toLowerCase()).maybeSingle()
  if (suppressed) return response()
  await admin.from('portal_invites').update({ status: 'invalidado_por_reenvio' }).eq('account_id', account.id).eq('purpose', 'recuperacao').eq('status', 'pendente')
  const token = generateToken(); const tokenHash = await hashToken(token)
  const { data: invite } = await admin.from('portal_invites').insert({ account_id: account.id, purpose: 'recuperacao', token_hash: tokenHash, sent_to_email: account.recovery_email, expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), status: 'pendente' }).select('id').single()
  if (!invite) return response()
  const customer = account.customers as { name?: string; cnpj_cpf?: string } | null
  const d = customer?.cnpj_cpf?.replace(/\D/g, '') ?? ''
  const template = recoveryTemplate({ companyName: customer?.name ?? 'sua empresa', cnpjMasked: d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}` : '***', recoveryUrl: `${Deno.env.get('PORTAL_URL') ?? ''}/portal/recuperar-senha?token=${encodeURIComponent(token)}`, supportEmail: Deno.env.get('PORTAL_SUPPORT_EMAIL') ?? 'suporte@transhipping.com' })
  await sendPortalEmail({ admin, kind: 'recuperacao', to: account.recovery_email, subject: template.subject, html: template.html, text: template.text, idempotencyKey: `recuperacao:${invite.id}`, accountId: account.id, inviteId: invite.id })
  return response()
})
