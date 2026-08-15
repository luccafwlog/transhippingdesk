import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1'
import { openAlertOnce } from '../_shared/portalAlerts.ts'

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
        if (!permanentBounce) continue
        // Sinal em coluna própria: `account_situation` é de valor único e
        // `ativo`/`falha_no_envio` são excludentes, então marcar `falha_no_envio`
        // numa conta ativa afirmaria que ela não está ativa -- e está, o cliente
        // continua entrando com a senha. São dois fatos independentes: a conta
        // funciona, e o Email de Recuperação quebrou.
        await admin.from('customer_portal_accounts').update({ recovery_email_status: status === 'bounce' ? 'bounce_permanente' : 'complaint' }).eq('customer_id', account.customer_id)
        await admin.from('customer_portal_accounts').update({ account_situation: 'falha_no_envio' }).eq('customer_id', account.customer_id).eq('account_situation', 'convite_pendente')
        // O alerta é sinal secundário: o estado autoritativo já foi gravado em
        // `recovery_email_status` acima, e é ele que o console lê. Deixar o
        // erro subir daqui abortaria os Clientes seguintes da mesma caixa e
        // devolveria 500 -- e o retry do Resend cairia na linha de dedup já
        // gravada, que responde 200 sem reprocessar nada. Falhar em avisar não
        // pode custar o registro do fato.
        try {
          await openAlertOnce(admin, {
            type: 'portal_email_suprimido',
            entityType: 'customer',
            entityId: String(account.customer_id),
            message: 'Email de Recuperação indisponível. Informe ou valide outro endereço.',
          })
        } catch (error) {
          console.error('[portal-email-webhook] falha ao abrir alerta de email suprimido', account.customer_id, error)
        }
      }
    }
  }
  return new Response(null, { status: 200 })
})
