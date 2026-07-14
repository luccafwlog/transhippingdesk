import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1'

const STATUS_BY_EVENT: Record<string, string> = { 'email.delivered': 'entregue', 'email.bounced': 'bounce', 'email.complained': 'complaint' }

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const payload = await req.text()
  const svixHeaders = { 'svix-id': req.headers.get('svix-id') ?? '', 'svix-timestamp': req.headers.get('svix-timestamp') ?? '', 'svix-signature': req.headers.get('svix-signature') ?? '' }
  let event: { type: string; data: { email_id?: string; to?: string[]; bounce?: { type?: string } } }
  try { event = new Webhook(Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').verify(payload, svixHeaders, { tolerance: 300 }) as typeof event } catch { return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 }) }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error: dedupError } = await admin.from('portal_email_events').insert({ provider_event_id: svixHeaders['svix-id'], event_type: event.type })
  if (dedupError?.code === '23505') return new Response(null, { status: 200 })
  if (dedupError) return new Response(null, { status: 500 })
  const status = STATUS_BY_EVENT[event.type]
  if (!status) return new Response(null, { status: 200 })
  const { data: attempt } = await admin.from('portal_email_attempts').select('id').eq('provider_message_id', event.data.email_id ?? '').maybeSingle()
  if (!attempt) return new Response(null, { status: 200 })
  await admin.from('portal_email_attempts').update({ status }).eq('id', attempt.id)
  await admin.from('portal_email_events').update({ attempt_id: attempt.id }).eq('provider_event_id', svixHeaders['svix-id'])
  if (status === 'bounce' || status === 'complaint') {
    const email = (event.data.to?.[0] ?? '').toLowerCase()
    if (email) {
      const permanentBounce = status === 'complaint' || event.data.bounce?.type === 'permanent'
      if (permanentBounce) await admin.from('portal_suppressed_emails').upsert({ email, reason: status === 'bounce' ? 'bounce_permanente' : 'complaint' }, { onConflict: 'email', ignoreDuplicates: true })
      const { data: affected } = await admin.from('customer_portal_accounts').select('customer_id').ilike('recovery_email', email)
      for (const account of affected ?? []) {
        if (permanentBounce) await admin.from('customer_portal_accounts').update({ account_situation: 'falha_no_envio' }).eq('customer_id', account.customer_id).eq('account_situation', 'convite_pendente')
        if (permanentBounce) await admin.from('alerts').insert({ type: 'portal_email_suprimido', entity_type: 'customer', entity_id: String(account.customer_id), message: 'Email de Recuperação indisponível. Informe ou valide outro endereço.', status: 'open' })
      }
    }
  }
  return new Response(null, { status: 200 })
})
