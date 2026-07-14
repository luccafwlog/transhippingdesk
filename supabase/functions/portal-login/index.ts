import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GENERIC_ERROR = 'CNPJ ou senha inválidos.'
const ALLOWED_ORIGINS = new Set([
  'https://transhippingdesk.com.br',
  'https://portal.transhippingdesk.com.br',
  'https://transhippingdesk.web.app',
  'https://transhippingdesk.firebaseapp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

export function normalizeCnpj(input: string): string | null {
  const digits = (input ?? '').replace(/\D/g, '')
  return digits.length === 14 ? digits : null
}

function json(status: number, body: unknown, origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null'
  return new Response(JSON.stringify(body), {
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
    const { data: blocked, error: rateError } = await admin.rpc('portal_login_check_rate_limit', { p_login: normalized })
    if (rateError || blocked === true) {
      const { data: blockedAccount } = await admin.from('customer_portal_accounts').select('customer_id').eq('login_cnpj', normalized).maybeSingle()
      if (blockedAccount) {
        const { data: existingAlert } = await admin.from('alerts').select('id').eq('type', 'portal_abuso_login').eq('entity_type', 'customer').eq('entity_id', String(blockedAccount.customer_id)).neq('status', 'closed').maybeSingle()
        if (!existingAlert) await admin.from('alerts').insert({ type: 'portal_abuso_login', entity_type: 'customer', entity_id: String(blockedAccount.customer_id), message: 'Muitas tentativas de login no Portal. Verifique a origem e contate o Cliente se necessário.', status: 'open' })
      }
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    const { data: account } = await admin.from('customer_portal_accounts').select('auth_user_id, account_situation').eq('login_cnpj', normalized).maybeSingle()
    if (!account || account.account_situation !== 'ativo' || !account.auth_user_id) {
      await admin.rpc('portal_login_register_failure', { p_login: normalized })
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    const { data: user } = await admin.auth.admin.getUserById(account.auth_user_id)
    const technicalEmail = user.user?.email
    if (!technicalEmail) {
      await admin.rpc('portal_login_register_failure', { p_login: normalized })
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    const authClient = createClient(url, anonKey)
    const { data: session, error } = await authClient.auth.signInWithPassword({ email: technicalEmail, password: body.password })
    if (error || !session.session) {
      await admin.rpc('portal_login_register_failure', { p_login: normalized })
      return json(401, { error: GENERIC_ERROR }, origin)
    }

    await admin.rpc('portal_login_register_success', { p_login: normalized })
    await admin.from('customer_portal_accounts').update({ last_login_at: new Date().toISOString() }).eq('login_cnpj', normalized)
    return json(200, {
      access_token: session.session.access_token,
      refresh_token: session.session.refresh_token,
      expires_at: session.session.expires_at,
    }, origin)
  })
}
