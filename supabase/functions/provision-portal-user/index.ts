// Edge Function: provision-portal-user
//
// Cria ou atualiza um usuário Supabase Auth para uma conta de portal de cliente.
// Requer autenticação interna (usuário ativo com role administrativo).
// Chamado por: src/pages/ClienteFicha.tsx ao criar/resetar acesso do portal.
//
// Env vars necessárias:
//   SUPABASE_URL          — project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (acesso admin)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    if (!profile?.active || profile?.role !== 'administrativo') {
      return new Response(JSON.stringify({ error: 'Forbidden: only administrativo role can provision portal users' }), {
        status: 403,
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
      if (createError) throw createError
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
    const message = err instanceof Error ? err.message : 'Internal server error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
