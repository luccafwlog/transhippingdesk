import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPortalEmail } from '../_shared/portalEmail.ts'

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const expectedSecret = Deno.env.get('PORTAL_DIGEST_SECRET')
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!expectedSecret || providedSecret !== expectedSecret) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ data: failures }, { data: events }, { data: pending }, { data: users }] = await Promise.all([
    admin.from('portal_email_attempts').select('id').in('status', ['bounce', 'complaint', 'falha_transitoria', 'falha_permanente']).gte('created_at', since),
    admin.from('portal_provisioning_events').select('id').gte('created_at', since),
    admin.from('customer_portal_accounts').select('id').eq('account_situation', 'convite_pendente'),
    admin.from('user_profiles').select('id').eq('active', true).in('role', ['admin', 'administrativo', 'documentacao']),
  ])
  const counts = { failures: failures?.length ?? 0, activity: events?.length ?? 0, pending: pending?.length ?? 0 }
  if (counts.failures + counts.activity + counts.pending === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  const date = new Date().toISOString().slice(0, 10)
  const text = `Resumo do Portal — ${date}\n\nFalhas/supressões: ${counts.failures}\nAtividade de provisionamento: ${counts.activity}\nConvites pendentes: ${counts.pending}`
  const html = `<p>Resumo do Portal — ${date}</p><ul><li>Falhas/supressões: ${counts.failures}</li><li>Atividade: ${counts.activity}</li><li>Convites pendentes: ${counts.pending}</li></ul>`
  for (const user of users ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(user.id)
    const email = authUser.user?.email
    if (email) await sendPortalEmail({ admin, kind: 'resumo_diario', to: email, subject: `Resumo do Portal — ${date}`, html, text, idempotencyKey: `resumo:${date}:${email.toLowerCase()}` })
  }
  return new Response(JSON.stringify({ sent: users?.length ?? 0 }), { status: 200 })
})
