import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { renderDemurrageTemplate } from '../_shared/customerCommunicationTemplates.ts'
import { maskEmail, sendEmail } from '../_shared/email.ts'

type DunningCandidate = {
  invoice_id: number
  customer_id: number
  bl_id: string
  doc_number: string
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
  roe_source: string | null
  first_billed_at: string
  claimed_at: string
  roe_reference_date: string
  attempt_discriminator: number
}

type DunningContact = { id: number; customer_id: number | null; email: string | null }
type DunningPreference = { contact_id: number; nature: string; enabled: boolean }
type Suppression = { email: string; reason?: string | null }
type InvoiceContext = {
  id: number
  customer_id: number
  bl_id: string
  doc_number: string
  total_usd: number
  current_total_brl: number | null
  current_roe: number | null
  first_billed_at: string | null
  updated_at: string | null
  customer: { id: number; name: string } | null
  bl: {
    id: string
    pod: string | null
    voyage: { id: number; voyage_number: string; vessel: { name: string } | null } | null
  } | null
}

const CLAIM_BATCH_SIZE = 50

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asCandidates(value: unknown): DunningCandidate[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is DunningCandidate => {
    if (!isRecord(item)) return false
    return Number.isFinite(Number(item.invoice_id))
      && Number.isFinite(Number(item.customer_id))
      && typeof item.bl_id === 'string'
      && typeof item.doc_number === 'string'
      && Number.isFinite(Number(item.total_usd))
      && typeof item.claimed_at === 'string'
      && Number.isFinite(Number(item.attempt_discriminator))
  }).map((item) => ({
    invoice_id: Number(item.invoice_id),
    customer_id: Number(item.customer_id),
    bl_id: String(item.bl_id),
    doc_number: String(item.doc_number),
    total_usd: Number(item.total_usd),
    current_total_brl: item.current_total_brl == null ? null : Number(item.current_total_brl),
    current_roe: item.current_roe == null ? null : Number(item.current_roe),
    roe_source: item.roe_source == null ? null : String(item.roe_source),
    first_billed_at: String(item.first_billed_at ?? ''),
    claimed_at: String(item.claimed_at),
    roe_reference_date: String(item.roe_reference_date ?? ''),
    attempt_discriminator: Number(item.attempt_discriminator),
  }))
}

function normalizeNested<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function portalBillingUrl(): string {
  const configured = (Deno.env.get('PORTAL_URL') ?? '').trim().replace(/\/+$/, '')
  if (!configured) return 'https://portal.transhippingdesk.com.br/portal/billing'
  return configured.endsWith('/billing') ? configured : `${configured}/billing`
}

function dateOnly(value: string | null | undefined): string {
  return value?.slice(0, 10) || new Date().toISOString().slice(0, 10)
}

async function loadRecipients(
  admin: ReturnType<typeof createClient>,
  customerId: number,
): Promise<DunningContact[]> {
  const { data: contactsData, error: contactsError } = await admin
    .from('customer_contacts')
    .select('id, customer_id, email')
    .eq('customer_id', customerId)
  if (contactsError) throw contactsError
  const contacts = (contactsData ?? []) as DunningContact[]
  const contactIds = contacts.map((contact) => contact.id)
  const contactEmails = [...new Set(contacts.flatMap((contact) => {
    const email = (contact.email ?? '').trim()
    return email ? [email, email.toLowerCase()] : []
  }))]
  const [{ data: preferencesData, error: preferencesError }, { data: communicationData, error: communicationError }, { data: portalData, error: portalError }] = await Promise.all([
    contactIds.length
      ? admin.from('customer_contact_preferences').select('contact_id, nature, enabled').in('contact_id', contactIds)
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? admin.from('customer_communication_suppressions').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
    contactEmails.length
      ? admin.from('portal_suppressed_emails').select('email, reason').in('email', contactEmails)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (preferencesError) throw preferencesError
  if (communicationError) throw communicationError
  if (portalError) throw portalError

  const preferences = (preferencesData ?? []) as DunningPreference[]
  const communicationSuppressions = (communicationData ?? []) as Suppression[]
  const portalSuppressions = (portalData ?? []) as Suppression[]
  const isSuppressed = (email: string) => communicationSuppressions.some((row) => normalizeEmail(row.email) === email)
    || portalSuppressions.some((row) => normalizeEmail(row.email) === email && row.reason === 'bounce_permanente')

  return contacts.filter((contact) => {
    const email = normalizeEmail(contact.email)
    if (!email || isSuppressed(email)) return false
    const preference = preferences.find((row) => row.contact_id === contact.id && row.nature === 'demurrage')
    return preference?.enabled !== false
  })
}

async function loadInvoice(
  admin: ReturnType<typeof createClient>,
  invoiceId: number,
): Promise<InvoiceContext> {
  const { data, error } = await admin
    .from('demurrage_invoices')
    .select('id, customer_id, bl_id, doc_number, total_usd, current_total_brl, current_roe, first_billed_at, updated_at, customer:customers(id, name), bl:bls(id, pod, voyage:voyages(id, voyage_number, vessel:vessels(name)))')
    .eq('id', invoiceId)
    .single()
  if (error) throw error
  const row = data as InvoiceContext
  return {
    ...row,
    customer: normalizeNested(row.customer),
    bl: normalizeNested(row.bl),
  }
}

async function createCommunication(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
  context: InvoiceContext,
  vesselName: string,
  voyageNumber: string,
  terminalName: string | null,
): Promise<number> {
  const { data, error } = await admin.rpc('create_customer_communication_atomic', {
    p_customer_id: candidate.customer_id,
    p_kind: 'cobranca_demurrage',
    p_nature: 'demurrage',
    p_anchor_voyage_id: context.bl?.voyage?.id ?? null,
    p_anchor_port: context.bl?.pod ?? null,
    p_anchor_atracacao_id: null,
    p_anchor_invoice_id: candidate.invoice_id,
    p_attempt_discriminator: candidate.attempt_discriminator,
    p_dispatch_id: null,
    p_vessel_name: vesselName,
    p_voyage_number: voyageNumber,
    p_terminal_name: terminalName,
    p_created_by: null,
    p_bl_ids: [candidate.bl_id],
  })
  if (error) throw error
  const communicationId = Number(data)
  if (!Number.isInteger(communicationId) || communicationId <= 0) throw new Error('RPC não retornou o comunicado de Demurrage.')
  return communicationId
}

async function sendCandidate(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
  communicationsEnabled: boolean,
): Promise<'enviado' | 'simulado' | 'falha' | 'pausado'> {
  const context = await loadInvoice(admin, candidate.invoice_id)
  const contacts = await loadRecipients(admin, candidate.customer_id)
  if (!contacts.length) return 'pausado'

  const vesselName = context.bl?.voyage?.vessel?.name ?? ''
  const voyageNumber = context.bl?.voyage?.voyage_number ?? ''
  const currentRoe = Number(candidate.current_roe ?? context.current_roe ?? 0)
  if (!context.customer?.name || !vesselName || !voyageNumber || currentRoe <= 0) {
    throw new Error('Dados incompletos para o comunicado de Demurrage.')
  }
  const currentTotalBrl = Number(candidate.current_total_brl ?? context.current_total_brl ?? (candidate.total_usd * currentRoe))
  const template = renderDemurrageTemplate({
    customerId: candidate.customer_id,
    customerName: context.customer.name,
    vesselName,
    voyageNumber,
    port: context.bl?.pod ?? '—',
    milestoneAt: candidate.first_billed_at,
    bls: [{ id: candidate.bl_id, customerId: candidate.customer_id }],
    portalUrl: portalBillingUrl(),
    demurrage: {
      docNumber: candidate.doc_number,
      totalUsd: candidate.total_usd,
      totalBrl: currentTotalBrl,
      roe: currentRoe,
      roeReferenceDate: candidate.roe_reference_date || dateOnly(context.updated_at || context.first_billed_at),
    },
  })
  const communicationId = await createCommunication(admin, candidate, context, vesselName, voyageNumber, null)
  const resendApiKey = communicationsEnabled ? Deno.env.get('RESEND_API_KEY') : null
  if (communicationsEnabled && !resendApiKey) throw new Error('RESEND_API_KEY não está configurada para envio real.')
  let delivered = false
  let simulated = false
  for (const contact of contacts) {
    const recipient = normalizeEmail(contact.email)
    const idempotencyKey = `demurrage:${candidate.invoice_id}:${candidate.attempt_discriminator}:${candidate.claimed_at}:${recipient}`
    try {
      const sent = await sendEmail({
        kind: 'cobranca_demurrage',
        to: recipient,
        subject: template.subject,
        html: template.html,
        text: template.text,
        idempotencyKey,
        resendApiKey,
        from: Deno.env.get('PORTAL_FROM_EMAIL'),
        replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO'),
        missingConfigurationMessage: 'PORTAL_FROM_EMAIL e COMMUNICATIONS_REPLY_TO são obrigatórios para envio real',
        checkSuppression: async (to) => {
          const [{ data: communicationSuppression }, { data: portalSuppression }] = await Promise.all([
            admin.from('customer_communication_suppressions').select('id').eq('email', to).maybeSingle(),
            admin.from('portal_suppressed_emails').select('id').eq('email', to).eq('reason', 'bounce_permanente').maybeSingle(),
          ])
          return { suppressed: Boolean(communicationSuppression || portalSuppression) }
        },
        recordAttempt: async ({ idempotencyKey: attemptKey, to }) => {
          const { data, error } = await admin.from('customer_communication_attempts').insert({
            communication_id: communicationId,
            recipient_masked: maskEmail(to),
            status: 'aceito',
            idempotency_key: attemptKey,
          }).select('id').single()
          if (error || !data) throw error ?? new Error('Não foi possível registrar a tentativa de Demurrage.')
          return { id: data.id }
        },
        updateAttempt: async (attemptId, update) => {
          const { error } = await admin.from('customer_communication_attempts').update({
            provider_message_id: update.providerMessageId,
            retry_count: update.retryCount,
            status: update.status,
            last_error: update.lastError,
          }).eq('id', attemptId)
          if (error) throw error
        },
      })
      if (sent.ok) {
        if (communicationsEnabled) delivered = true
        else simulated = true
      }
    } catch (error) {
      console.error('[demurrage-dunning] falha no envio', candidate.invoice_id, recipient, error)
    }
  }

  const status = delivered ? 'enviado' : simulated ? 'simulado' : 'falha'
  await admin.from('customer_communications').update({ status }).eq('id', communicationId)
  return status
}

async function releaseClaim(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
): Promise<void> {
  const { error } = await admin.rpc('release_demurrage_dunning_claim', {
    p_demurrage_invoice_id: candidate.invoice_id,
    p_attempt_discriminator: candidate.attempt_discriminator,
  })
  if (error) throw error
}

async function releaseClaimSafely(
  admin: ReturnType<typeof createClient>,
  candidate: DunningCandidate,
): Promise<void> {
  try {
    await releaseClaim(admin, candidate)
  } catch (error) {
    console.error('[demurrage-dunning] falha ao liberar claim', candidate.invoice_id, error)
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const expectedSecret = Deno.env.get('DEMURRAGE_DUNNING_SECRET') ?? ''
  const providedSecret = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) return json(401, { error: 'Unauthorized' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' })
  const admin = createClient(url, serviceKey)
  const [{ data: settings, error: settingsError }, { data: claimed, error: claimError }] = await Promise.all([
    admin.from('app_settings').select('communications_enabled').eq('id', 1).maybeSingle(),
    admin.rpc('claim_demurrage_dunning_candidates', {
      p_as_of: new Date().toISOString(),
      p_limit: CLAIM_BATCH_SIZE,
    }),
  ])
  if (settingsError || claimError) {
    console.error('[demurrage-dunning] falha ao preparar o ciclo', settingsError ?? claimError)
    return json(500, { error: 'Falha ao preparar a régua de Demurrage.' })
  }

  const communicationsEnabled = Boolean((settings as { communications_enabled?: boolean } | null)?.communications_enabled)
  const candidates = asCandidates(claimed)
  let sent = 0
  let simulated = 0
  let failed = 0
  let paused = 0
  for (const candidate of candidates) {
    try {
      const result = await sendCandidate(admin, candidate, communicationsEnabled)
      if (result === 'enviado') sent += 1
      else {
        await releaseClaimSafely(admin, candidate)
        if (result === 'simulado') simulated += 1
        else if (result === 'falha') failed += 1
        else paused += 1
      }
    } catch (error) {
      failed += 1
      await releaseClaimSafely(admin, candidate)
      console.error('[demurrage-dunning] candidato inválido', candidate.invoice_id, error)
    }
  }
  return json(200, { claimed: candidates.length, sent, simulated, failed, paused })
}

if (typeof Deno !== 'undefined') Deno.serve(handler)
