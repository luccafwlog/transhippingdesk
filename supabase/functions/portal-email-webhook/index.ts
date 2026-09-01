import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Webhook } from 'https://esm.sh/svix@1'
import { maskEmail, sendPortalEmail } from '../_shared/portalEmail.ts'
import { openAlertOnce } from '../_shared/portalAlerts.ts'
import { resolveBounceCascade, type BounceContact } from '../_shared/portalBounceCascade.ts'

const STATUS_BY_EVENT: Record<string, string> = {
  'email.delivered': 'entregue',
  'email.bounced': 'bounce',
  'email.complained': 'complaint',
}
const BOUNCE_NOTIFICATION_KIND = 'contato_bounced_notificacao'

type ResendEvent = {
  type: string
  data: {
    email_id?: string
    to?: string[]
    bounce?: { type?: string }
  }
}

type PortalAttempt = {
  id: number
  kind: string
  account_id: number | null
}

type CommunicationAttempt = {
  id: number
  communication_id: number
}

type PortalAccount = {
  id: number
  customer_id: number
  account_situation: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function escapeHtml(value: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character)
}

async function recordPortalSuppression(
  admin: ReturnType<typeof createClient>,
  email: string,
  reason: 'bounce_permanente' | 'complaint',
): Promise<void> {
  const normalizedEmail = normalizeEmail(email)

  if (reason === 'bounce_permanente') {
    // O conflito não é ignorado: um bounce permanente deve escalar uma linha
    // de complaint existente e renovar o momento da supressão.
    const { error } = await admin.from('portal_suppressed_emails').upsert({
      email: normalizedEmail,
      reason,
      suppressed_at: new Date().toISOString(),
    }, { onConflict: 'email' })
    if (error) throw error
    return
  }

  // Complaint é específico do canal do Portal. Se o mesmo endereço já foi
  // elevado a bounce_permanente, jamais o rebaixe por um evento posterior.
  const { data: existing, error: lookupError } = await admin
    .from('portal_suppressed_emails')
    .select('reason')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (lookupError) throw lookupError
  if (existing) return

  const { error: insertError } = await admin.from('portal_suppressed_emails').insert({
    email: normalizedEmail,
    reason,
  })
  if (insertError && insertError.code !== '23505') throw insertError
}

async function recordCommunicationComplaint(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<void> {
  const { error } = await admin.from('customer_communication_suppressions').upsert({
    email: normalizeEmail(email),
    reason: 'complaint',
  }, { onConflict: 'email' })
  if (error) throw error
}

async function loadPortalSuppressionSets(
  admin: ReturnType<typeof createClient>,
  contacts: readonly BounceContact[],
): Promise<{ portalSuppressedEmails: string[]; sharedBounceEmails: string[] }> {
  const emails = [...new Set(contacts
    .map((contact) => contact.email)
    .filter((email): email is string => Boolean(email))
    .map(normalizeEmail))]
  if (!emails.length) return { portalSuppressedEmails: [], sharedBounceEmails: [] }

  const { data, error } = await admin
    .from('portal_suppressed_emails')
    .select('email, reason')
    .in('email', emails)
  if (error) throw error

  const suppressions = (data ?? []) as Array<{ email: string; reason: string }>
  return {
    portalSuppressedEmails: suppressions.map((suppression) => normalizeEmail(suppression.email)),
    sharedBounceEmails: suppressions
      .filter((suppression) => suppression.reason === 'bounce_permanente')
      .map((suppression) => normalizeEmail(suppression.email)),
  }
}

async function sendBounceNotification(
  admin: ReturnType<typeof createClient>,
  customerId: number,
  bouncedEmail: string,
  recipient: BounceContact,
): Promise<void> {
  if (!recipient.email) return

  const normalizedBouncedEmail = normalizeEmail(bouncedEmail)
  const maskedBouncedEmail = maskEmail(normalizedBouncedEmail)
  const subject = 'Falha de entrega: atualize o cadastro do cliente'
  const text = `O endereço ${maskedBouncedEmail} não recebeu um comunicado. Atualize o cadastro do cliente para evitar novas falhas de entrega.`
  const html = `<p>O endereço <strong>${escapeHtml(maskedBouncedEmail)}</strong> não recebeu um comunicado.</p><p>Atualize o cadastro do cliente para evitar novas falhas de entrega.</p>`

  try {
    const sent = await sendPortalEmail({
      admin,
      kind: BOUNCE_NOTIFICATION_KIND,
      to: recipient.email,
      subject,
      html,
      text,
      idempotencyKey: `${BOUNCE_NOTIFICATION_KIND}:${customerId}:${normalizedBouncedEmail}:${recipient.id}`,
    })
    if (!sent.ok) {
      console.warn('[portal-email-webhook] notificação de bounce não enviada', customerId, recipient.id)
    }
  } catch (error) {
    console.error('[portal-email-webhook] falha ao enviar notificação de bounce', customerId, error)
  }
}

async function openNoAlternativeAlert(
  admin: ReturnType<typeof createClient>,
  customerId: number,
): Promise<void> {
  try {
    const alert = {
      type: 'cliente_contato_bounced_sem_alternativa',
      entityType: 'customer',
      entityId: String(customerId),
      message: 'Cliente sem contato alternativo válido após bounce permanente; atualize o cadastro.',
    }
    await openAlertOnce(admin, alert)
  } catch (error) {
    console.error('[portal-email-webhook] falha ao abrir alerta de contato sem alternativa', customerId, error)
  }
}

async function handleBounceCascade(
  admin: ReturnType<typeof createClient>,
  customerIds: readonly number[],
  bouncedEmail: string,
): Promise<void> {
  for (const customerId of [...new Set(customerIds)]) {
    const { data: contacts, error: contactsError } = await admin
      .from('customer_contacts')
      .select('id, email, is_primary')
      .eq('customer_id', customerId)
    if (contactsError) {
      console.error('[portal-email-webhook] falha ao consultar contatos para cascata', customerId, contactsError)
      continue
    }

    const bounceContacts = (contacts ?? []) as BounceContact[]
    let suppressionSets: { portalSuppressedEmails: string[]; sharedBounceEmails: string[] }
    try {
      suppressionSets = await loadPortalSuppressionSets(admin, bounceContacts)
    } catch (error) {
      console.error('[portal-email-webhook] falha ao consultar supressões para cascata', customerId, error)
      continue
    }

    const decision = resolveBounceCascade({
      contacts: bounceContacts,
      bouncedEmail,
      ...suppressionSets,
    })

    if (decision.notificationRecipient) {
      await sendBounceNotification(admin, customerId, bouncedEmail, decision.notificationRecipient)
    }
    if (decision.shouldOpenAlert) await openNoAlternativeAlert(admin, customerId)
  }
}

if (typeof Deno !== 'undefined') Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 })
  const payload = await req.text()
  const svixHeaders = {
    'svix-id': req.headers.get('svix-id') ?? '',
    'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
    'svix-signature': req.headers.get('svix-signature') ?? '',
  }
  let event: ResendEvent
  try {
    event = new Webhook(Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '').verify(payload, svixHeaders, { tolerance: 300 }) as ResendEvent
  } catch {
    return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 })
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error: dedupError } = await admin.from('portal_email_events').insert({
    provider_event_id: svixHeaders['svix-id'],
    event_type: event.type,
  })
  if (dedupError?.code === '23505') return new Response(null, { status: 200 })
  if (dedupError) return new Response(null, { status: 500 })

  const status = STATUS_BY_EVENT[event.type]
  if (!status) return new Response(null, { status: 200 })

  const providerMessageId = event.data.email_id ?? ''
  const { data: portalAttempt, error: portalAttemptError } = await admin
    .from('portal_email_attempts')
    .select('id, kind, account_id')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle() as { data: PortalAttempt | null; error: { code?: string; message?: string } | null }
  if (portalAttemptError) return new Response(null, { status: 500 })

  let communicationAttempt: CommunicationAttempt | null = null
  if (!portalAttempt) {
    const { data, error } = await admin
      .from('customer_communication_attempts')
      .select('id, communication_id')
      .eq('provider_message_id', providerMessageId)
      .maybeSingle() as { data: CommunicationAttempt | null; error: { code?: string; message?: string } | null }
    if (error) return new Response(null, { status: 500 })
    communicationAttempt = data
  }

  if (!portalAttempt && !communicationAttempt) return new Response(null, { status: 200 })

  if (portalAttempt) {
    const { error } = await admin.from('portal_email_attempts').update({ status }).eq('id', portalAttempt.id)
    if (error) console.error('[portal-email-webhook] falha ao atualizar tentativa do Portal', portalAttempt.id, error)
    const { error: eventLinkError } = await admin
      .from('portal_email_events')
      .update({ attempt_id: portalAttempt.id })
      .eq('provider_event_id', svixHeaders['svix-id'])
    if (eventLinkError) console.error('[portal-email-webhook] falha ao vincular evento à tentativa do Portal', eventLinkError)
  } else if (communicationAttempt) {
    const { error } = await admin
      .from('customer_communication_attempts')
      .update({ status })
      .eq('id', communicationAttempt.id)
    if (error) console.error('[portal-email-webhook] falha ao atualizar tentativa de Comunicado', communicationAttempt.id, error)
    const { error: eventLinkError } = await admin
      .from('portal_email_events')
      .update({ communication_attempt_id: communicationAttempt.id })
      .eq('provider_event_id', svixHeaders['svix-id'])
    if (eventLinkError) console.error('[portal-email-webhook] falha ao vincular evento à tentativa de Comunicado', eventLinkError)
  }

  const email = normalizeEmail(event.data.to?.[0] ?? '')
  if (!email || (status !== 'bounce' && status !== 'complaint')) return new Response(null, { status: 200 })

  const permanentBounce = status === 'bounce' && event.data.bounce?.type?.toLowerCase() === 'permanent'
  try {
    if (permanentBounce) {
      await recordPortalSuppression(admin, email, 'bounce_permanente')
    } else if (status === 'complaint' && portalAttempt) {
      await recordPortalSuppression(admin, email, 'complaint')
    } else if (status === 'complaint' && communicationAttempt) {
      await recordCommunicationComplaint(admin, email)
    }
  } catch (error) {
    console.error('[portal-email-webhook] falha ao registrar supressão', email, error)
  }

  let affected: PortalAccount[] = []
  const isPortalRecoveryAttempt = Boolean(portalAttempt && portalAttempt.kind !== BOUNCE_NOTIFICATION_KIND)
  if (portalAttempt && isPortalRecoveryAttempt && (permanentBounce || status === 'complaint')) {
    const { data, error } = await admin
      .from('customer_portal_accounts')
      .select('id, customer_id, account_situation')
      .ilike('recovery_email', email)
    if (error) return new Response(null, { status: 500 })
    affected = (data ?? []) as PortalAccount[]
  }

  if (portalAttempt && isPortalRecoveryAttempt) {
    for (const account of affected ?? []) {
      if (!(permanentBounce || status === 'complaint')) continue
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

  if (permanentBounce && portalAttempt?.kind !== BOUNCE_NOTIFICATION_KIND) {
    const customerIds = affected.map((account) => account.customer_id)
    if (portalAttempt?.account_id && customerIds.length === 0) {
      const { data: accountById, error: accountError } = await admin
        .from('customer_portal_accounts')
        .select('customer_id')
        .eq('id', portalAttempt.account_id)
        .maybeSingle()
      if (accountError) console.error('[portal-email-webhook] falha ao consultar conta por id', portalAttempt.account_id, accountError)
      if (accountById?.customer_id) customerIds.push(Number(accountById.customer_id))
    }
    if (communicationAttempt) {
      const { data: communication, error } = await admin
        .from('customer_communications')
        .select('customer_id')
        .eq('id', communicationAttempt.communication_id)
        .maybeSingle()
      if (error) return new Response(null, { status: 500 })
      if (communication?.customer_id) customerIds.push(Number(communication.customer_id))
    }
    await handleBounceCascade(admin, customerIds, email)
  }

  return new Response(null, { status: 200 })
})
