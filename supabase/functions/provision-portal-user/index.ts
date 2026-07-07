// Edge Function: provision-portal-user
//
// Cria ou atualiza um usuário Supabase Auth para uma conta de portal de cliente.
// Requer autenticação interna (usuário ativo com role administrativo).
// Chamado por: src/pages/ClienteFicha.tsx ao criar/resetar acesso do portal.
//
// Env vars necessárias:
//   SUPABASE_URL          — project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (acesso admin)
//   SUPABASE_ANON_KEY     — anon key (validação do chamador)
//   APP_URL               — origem do app interno (CORS fail-closed)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Subset prático de RFC 5322: rejeita formatos inválidos como `a@b.c` (TLD < 2),
// `user@.com` ou domínios sem ponto.
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/
const PASSWORD_MIN_LENGTH = 8

// CORS restrito às origens do app interno. O sistema é servido pelo Firebase
// Hosting, que responde em web.app e firebaseapp.com. APP_URL é um override
// opcional (env var no projeto Supabase) para outros ambientes.
const ALLOWED_ORIGINS = new Set(
  [
    Deno.env.get('APP_URL'),
    'https://transhippingdesk.web.app',
    'https://transhippingdesk.firebaseapp.com',
  ].filter((value): value is string => Boolean(value)),
)
const DEFAULT_ORIGIN = 'https://transhippingdesk.web.app'

function corsHeadersFor(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get('Origin')
  const corsHeaders = corsHeadersFor(requestOrigin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Defesa em profundidade contra CSRF: requisições de browser (com header
  // Origin) só são aceitas se a origem estiver na allowlist. Chamadas
  // server-to-server (sem Origin) continuam permitidas.
  if (requestOrigin && !ALLOWED_ORIGINS.has(requestOrigin)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Validar que o chamador é um admin ativo
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: callerUser } } = await callerClient.auth.getUser()
    if (!callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: profile } = await callerClient
      .from('user_profiles')
      .select('role, active')
      .eq('id', callerUser.id)
      .single()

    if (!profile?.active || (profile?.role !== 'administrativo' && profile?.role !== 'admin')) {
      return new Response(JSON.stringify({ error: 'Forbidden: only administrativo role can provision portal users' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Rate limit via DB — persistente entre instâncias (substitui o mapa em memória)
    const adminClientForRateLimit = createClient(supabaseUrl, serviceRoleKey)
    const { data: rateLimitOk, error: rateLimitError } = await adminClientForRateLimit
      .rpc('check_provision_rate_limit', { p_user_id: callerUser.id })

    if (rateLimitError || !rateLimitOk) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Tente novamente em 1 hora.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json() as {
      customer_portal_account_id: number
      portal_email: string
      password: string
    }

    if (!body.customer_portal_account_id || !body.portal_email || !body.password) {
      return new Response(JSON.stringify({ error: 'Missing required fields: customer_portal_account_id, portal_email, password' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!EMAIL_REGEX.test(body.portal_email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (body.password.length < PASSWORD_MIN_LENGTH) {
      return new Response(JSON.stringify({ error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Verificar se a conta de portal existe e pegar auth_user_id atual
    const { data: portalAccount, error: accountError } = await adminClient
      .from('customer_portal_accounts')
      .select('id, auth_user_id, customer_id')
      .eq('id', body.customer_portal_account_id)
      .single()

    if (accountError || !portalAccount) {
      return new Response(JSON.stringify({ error: 'Portal account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let authUserId: string

    if (portalAccount.auth_user_id) {
      // Atualizar usuário existente (reset de senha)
      const { data: updatedUser, error: updateError } = await adminClient.auth.admin.updateUserById(
        portalAccount.auth_user_id,
        { email: body.portal_email, password: body.password },
      )
      if (updateError) throw updateError
      authUserId = updatedUser.user.id
    } else {
      // Criar novo usuário Supabase Auth
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: body.portal_email,
        password: body.password,
        email_confirm: true,
        user_metadata: {
          portal: true,
          customer_id: portalAccount.customer_id,
        },
      })
      if (createError) {
        // Email já pertence a outro usuário (ex.: um login interno). No Supabase
        // Auth o email é único global, então não pode ser reaproveitado.
        const msg = (createError.message ?? '').toLowerCase()
        if ((createError as { status?: number }).status === 422 || msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
          return new Response(
            JSON.stringify({ error: 'Este email já está em uso por outro usuário do sistema. Use um email exclusivo para o acesso do cliente ao portal.' }),
            { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
        throw createError
      }
      authUserId = newUser.user.id
    }

    // Vincular auth_user_id à conta de portal
    const { error: linkError } = await adminClient
      .from('customer_portal_accounts')
      .update({
        auth_user_id: authUserId,
        portal_email: body.portal_email,
      })
      .eq('id', body.customer_portal_account_id)

    if (linkError) throw linkError

    return new Response(
      JSON.stringify({ success: true, auth_user_id: authUserId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('provision-portal-user error:', err)
    return new Response(JSON.stringify({ error: 'internal_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
