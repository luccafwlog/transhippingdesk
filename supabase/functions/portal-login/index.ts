import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ALLOWED_ORIGINS } from '../_shared/cors.ts'
import { openAlertOnce } from '../_shared/portalAlerts.ts'
import { isLoginRateLimited, registerLoginFailure, registerLoginSuccess } from '../_shared/portalLoginRateLimit.ts'

const GENERIC_ERROR = 'CNPJ ou senha inválidos.'

export function normalizeCnpj(input: string): string | null {
  const cnpj = (input ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase()
  return /^[0-9A-Z]{14}$/.test(cnpj) ? cnpj : null
}

function json(status: number, body: unknown, origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null'
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    const origin = req.headers.get('Origin')
    if (req.method === 'OPTIONS') return json(204, null, origin)
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

    const body = await req.json().catch(() => ({})) as { cnpj?: unknown; password?: unknown }
    const normalized = typeof body.cnpj === 'string' ? normalizeCnpj(body.cnpj) : null
    if (!normalized || typeof body.password !== 'string' || body.password.length === 0) return json(401, { error: GENERIC_ERROR }, origin)

    const url = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!url || !serviceKey || !anonKey) return json(500, { error: 'Portal indisponível.' }, origin)

    const admin = createClient(url, serviceKey)
    if (await isLoginRateLimited(admin, normalized)) {
      // O caminho bloqueado consultava a conta e, SÓ se ela existisse,
      // consultava e inseria o alerta: os dois desfechos devolvem o mesmo 401,
      // mas um fazia consistentemente uma consulta a mais que o outro. É o
      // mesmo oráculo por tempo do achado 3.2 da auditoria
      // security-audit-portal-2026-08-12, que a PR 527 fechou na recuperação e
      // que reapareceu no login. A resposta sai antes do trabalho terminar, na
      // mesma forma de portal-password-recovery.
      const alertWork = (async () => {
        const { data: blockedAccount } = await admin.from('customer_portal_accounts').select('customer_id').eq('login_cnpj', normalized).maybeSingle()
        if (!blockedAccount) return
        await openAlertOnce(admin, {
          type: 'portal_abuso_login',
          entityType: 'customer',
          entityId: String(blockedAccount.customer_id),
          message: 'Muitas tentativas de login no Portal. Verifique a origem e contate o Cliente se necessário.',
        })
      })().catch((error) => console.error('[portal-login] falha ao registrar alerta de abuso em segundo plano', error))
      if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(alertWork)
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    const { data: account } = await admin.from('customer_portal_accounts').select('auth_user_id, account_situation').eq('login_cnpj', normalized).maybeSingle()
    if (!account || account.account_situation !== 'ativo' || !account.auth_user_id) {
      await registerLoginFailure(admin, normalized)
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    const { data: user } = await admin.auth.admin.getUserById(account.auth_user_id)
    const technicalEmail = user.user?.email
    if (!technicalEmail) {
      await registerLoginFailure(admin, normalized)
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    const authClient = createClient(url, anonKey)
    const { data: session, error } = await authClient.auth.signInWithPassword({ email: technicalEmail, password: body.password })
    if (error || !session.session) {
      await registerLoginFailure(admin, normalized)
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    await registerLoginSuccess(admin, normalized)
    await admin.from('customer_portal_accounts').update({ last_login_at: new Date().toISOString() }).eq('login_cnpj', normalized)
    return json(200, {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_at: session.session.expires_at,
    }, origin)
  })
}
