import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, withCors } from '../_shared/cors.ts'
import { maskEmail, sendEmail, type EmailAttachment, type EmailAttemptRecord } from '../_shared/email.ts'
import {
  assertValidCommunicationAttachments,
  renderCeMercanteTaxasTemplate,
  type CustomerCommunicationKind,
  type CommunicationAttachment,
} from '../_shared/customerCommunicationTemplates.ts'

const ALLOWED_KINDS = new Set<CustomerCommunicationKind>([
  'aviso_chegada_noa',
  'aviso_prontidao_nor',
  'aviso_atracacao_nob',
  'ce_mercante_taxas',
  'cobranca_demurrage',
  'institucional',
  'livre',
])
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type DispatchPayload = {
  customer_id?: number
  kind?: string
  nature?: string
  recipient?: string
  subject?: string
  html?: string
  text?: string
  bl_ids?: string[]
  anchor_voyage_id?: number | null
  anchor_port?: string | null
  anchor_atracacao_id?: string | null
  anchor_invoice_id?: number | null
  attempt_discriminator?: number
  dispatch_id?: string | null
  vessel_name?: string | null
  voyage_number?: string | null
  terminal_name?: string | null
  idempotency_key?: string
  attachments?: Array<{
    filename?: string
    content_type?: string
    size?: number
    content_base64?: string
  }>
  origin?: 'manual' | 'automatico'
}

type ContactRow = { id: number; customer_id: number | null; email: string | null }

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  })
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePayload(value: unknown): DispatchPayload {
  if (!isRecord(value)) throw new Error('Payload inválido.')
  return value as DispatchPayload
}

function natureForKind(kind: string, nature: string): boolean {
  if (kind === 'aviso_chegada_noa' || kind === 'aviso_prontidao_nor' || kind === 'aviso_atracacao_nob') return nature === 'avisos_operacionais'
  if (kind === 'ce_mercante_taxas') return nature === 'documentacao'
  if (kind === 'cobranca_demurrage') return nature === 'demurrage'
  if (kind === 'institucional') return nature === 'avisos_gerais'
  return ['avisos_gerais', 'avisos_operacionais', 'documentacao', 'demurrage'].includes(nature)
}

function assertBase64Content(value: string): void {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('Conteúdo de anexo inválido.')
  }
}

function decodeBase64ByteLength(value: string): number {
  assertBase64Content(value)
  try {
    return atob(value).length
  } catch {
    throw new Error('Conteúdo de anexo inválido.')
  }
}

function decodeBase64Bytes(value: string): Uint8Array {
  assertBase64Content(value)
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new Error('Conteúdo de anexo inválido.')
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeStorageFileName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return safe || 'anexo'
}

function portalBillingUrl(): string {
  const configured = (Deno.env.get('PORTAL_URL') ?? '').trim().replace(/\/+$/, '')
  if (!configured) return 'https://portal.transhippingdesk.com.br/portal/billing'
  return configured.endsWith('/billing') ? configured : `${configured}/billing`
}

function isAlreadyExists(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.statusCode === 409
    || error.code === '23505'
    || /already exists|duplicate/i.test(String(error.message ?? ''))
}

async function persistCommunicationAttachments(
  admin: ReturnType<typeof createClient>,
  communicationId: number,
  attachments: readonly CommunicationAttachment[],
  uploadedBy: string | null,
): Promise<void> {
  if (!attachments.length) return

  type PersistedAttachment = { storage_path: string; size_bytes: number }
  const prepared = await Promise.all(attachments.map(async (attachment, index) => ({
    attachment,
    storagePath: `${communicationId}/${await sha256Hex(`${index}:${attachment.contentBase64 ?? ''}`)}-${index + 1}-${safeStorageFileName(attachment.filename)}`,
    bytes: decodeBase64Bytes(attachment.contentBase64 ?? ''),
  })))
  const { data: existingData, error: existingError } = await admin
    .from('customer_communication_attachments')
    .select('storage_path, size_bytes')
    .eq('communication_id', communicationId)
  if (existingError) throw existingError
  const existing = (existingData ?? []) as PersistedAttachment[]
  const existingPaths = new Set(existing.map((row) => row.storage_path))
  const newAttachments = prepared.filter((item) => !existingPaths.has(item.storagePath))
  const existingBytes = existing.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0)
  const newBytes = newAttachments.reduce((sum, item) => sum + item.bytes.length, 0)
  if (existing.length + newAttachments.length > 3) {
    throw new Error('O comunicado não pode ter mais de 3 anexos.')
  }
  if (existingBytes + newBytes > 10 * 1024 * 1024) {
    throw new Error('O tamanho total dos anexos do comunicado não pode ultrapassar 10 MB.')
  }
  if (!newAttachments.length) return

  const uploadedNow: string[] = []
  try {
    for (const item of newAttachments) {
      const { attachment, storagePath, bytes } = item
      const { error: uploadError } = await admin.storage
        .from('customer-communications')
        .upload(storagePath, bytes, { contentType: attachment.contentType, upsert: false })
      if (uploadError && !isAlreadyExists(uploadError)) throw uploadError
      if (!uploadError) uploadedNow.push(storagePath)

      const { error: metadataError } = await admin.from('customer_communication_attachments').insert({
        communication_id: communicationId,
        storage_path: storagePath,
        file_name: attachment.filename,
        mime_type: attachment.contentType,
        size_bytes: attachment.size,
        uploaded_by: uploadedBy,
      })
      if (metadataError && !isAlreadyExists(metadataError)) throw metadataError
    }
  } catch (error) {
    if (uploadedNow.length) {
      await admin.storage.from('customer-communications').remove(uploadedNow).catch(() => undefined)
    }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  return isRecord(error) && error.code === '23505'
}

type CommunicationIdentityRow = {
  id: number
  anchor_voyage_id: number | null
  anchor_port: string | null
  anchor_atracacao_id: string | null
  anchor_invoice_id: number | null
  dispatch_id: string | null
}

function normalizedAnchorPort(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

async function findExistingCommunicationId(
  admin: ReturnType<typeof createClient>,
  input: {
    customerId: number
    kind: string
    nature: string
    anchorVoyageId?: number | null
    anchorPort?: string | null
    anchorAtracacaoId?: string | null
    anchorInvoiceId?: number | null
    attemptDiscriminator: number
    dispatchId?: string | null
  },
): Promise<number | null> {
  let query = admin
    .from('customer_communications')
    .select('id, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, dispatch_id')
    .eq('customer_id', input.customerId)
    .eq('kind', input.kind)
    .eq('nature', input.nature)
    .eq('attempt_discriminator', input.attemptDiscriminator)
  query = input.anchorVoyageId == null
    ? query.is('anchor_voyage_id', null)
    : query.eq('anchor_voyage_id', input.anchorVoyageId)
  const { data, error } = await query
    .order('id', { ascending: false })
    .limit(20)
  if (error) throw error

  const anchorPort = normalizedAnchorPort(input.anchorPort)
  const row = ((data ?? []) as CommunicationIdentityRow[]).find((candidate) =>
    candidate.anchor_voyage_id === (input.anchorVoyageId ?? null)
    && candidate.anchor_port === anchorPort
    && (candidate.anchor_atracacao_id ?? null) === (input.anchorAtracacaoId ?? null)
    && (candidate.anchor_invoice_id ?? null) === (input.anchorInvoiceId ?? null)
    && (candidate.dispatch_id ?? null) === (input.dispatchId ?? null),
  )
  return row?.id ?? null
}

function timingSafeEqual(leftValue: string, rightValue: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(leftValue)
  const right = encoder.encode(rightValue)
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin')
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' }, origin)

  const jwt = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(jwt)) return json(401, { error: 'Autenticação obrigatória.' }, origin)

  const automationSecret = Deno.env.get('CUSTOMER_COMMUNICATION_AUTOMATION_SECRET') ?? ''
  const providedAutomationSecret = req.headers.get('X-Communication-Automation-Secret') ?? ''
  const isAutomation = Boolean(automationSecret && timingSafeEqual(providedAutomationSecret, automationSecret))

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: jwt } } })
  const { data: role, error: roleError } = isAutomation ? { data: 'automatico', error: null } : await caller.rpc('portal_current_role')
  if (!isAutomation && (roleError || !['administrativo', 'documentacao', 'equipamentos'].includes(String(role)))) {
    return json(403, { error: 'Sem permissão para Comunicados.' }, origin)
  }
  const { data: callerUser } = isAutomation ? { data: { user: null } } : await caller.auth.getUser()
  if (!isAutomation && !callerUser.user) return json(401, { error: 'Sessão inválida.' }, origin)

  let body: DispatchPayload
  try {
    body = parsePayload(await req.json())
  } catch (error) {
    return json(422, { error: error instanceof Error ? error.message : 'Payload inválido.' }, origin)
  }

  const customerId = Number(body.customer_id)
  const kind = String(body.kind ?? '')
  const nature = String(body.nature ?? '').trim()
  const recipient = normalizeEmail(String(body.recipient ?? ''))
  const subject = String(body.subject ?? '').trim()
  const html = String(body.html ?? '')
  const text = String(body.text ?? '')
  const attemptDiscriminator = Number(body.attempt_discriminator ?? 0)
  if (!Number.isInteger(customerId) || customerId <= 0) return json(422, { error: 'Cliente inválido.' }, origin)
  if (!ALLOWED_KINDS.has(kind as CustomerCommunicationKind)) return json(422, { error: 'Tipo de comunicado não disponível neste bloco.' }, origin)
  // A natureza é validada antes de qualquer renderização/mensagem para não
  // permitir que um payload incompleto contorne o isolamento da fundação.
  if (!nature || !natureForKind(kind, nature)) return json(422, { error: 'Natureza inválida ou ausente.' }, origin)
  if (!EMAIL_PATTERN.test(recipient)) return json(422, { error: 'Destinatário inválido.' }, origin)
  if (kind !== 'ce_mercante_taxas' && (!subject || !html || !text)) return json(422, { error: 'Assunto e conteúdo do comunicado são obrigatórios.' }, origin)
  if (kind === 'cobranca_demurrage') return json(422, { error: 'Cobrança de Demurrage é enviada exclusivamente pela régua automática.' }, origin)
  if (!Number.isInteger(attemptDiscriminator) || attemptDiscriminator < 0) return json(422, { error: 'Discriminador de tentativa inválido.' }, origin)

  const blIds = body.bl_ids ?? []
  if (!Array.isArray(blIds) || !blIds.every((blId) => typeof blId === 'string' && blId.trim().length > 0)) {
    return json(422, { error: 'B/Ls inválidos.' }, origin)
  }
  if (kind === 'institucional' && blIds.length > 0) {
    return json(422, { error: 'Comunicado institucional não pode conter B/Ls.' }, origin)
  }

  const attachments: CommunicationAttachment[] = []
  const emailAttachments: EmailAttachment[] = []
  try {
    for (const [index, attachment] of (body.attachments ?? []).entries()) {
      if (!attachment || typeof attachment !== 'object') return json(422, { error: `Anexo inválido na posição ${index + 1}.` }, origin)
      const filename = String(attachment.filename ?? '').trim()
      const contentType = String(attachment.content_type ?? '').trim().toLowerCase()
      const contentBase64 = String(attachment.content_base64 ?? '')
      const actualSize = decodeBase64ByteLength(contentBase64)
      const declaredSize = Number(attachment.size ?? actualSize)
      if (declaredSize !== actualSize) return json(422, { error: `Tamanho inconsistente no anexo ${index + 1}.` }, origin)
      attachments.push({ filename, contentType, size: actualSize, contentBase64 })
      emailAttachments.push({ filename, content: contentBase64, contentType })
    }
  } catch (error) {
    return json(422, { error: error instanceof Error ? error.message : 'Conteúdo de anexo inválido.' }, origin)
  }
  try {
    assertValidCommunicationAttachments(kind, attachments)
  } catch (error) {
    return json(422, { error: error instanceof Error ? error.message : 'Anexos inválidos.' }, origin)
  }

  const admin = createClient(url, serviceKey)
  let canonicalPayload: { subject: string; html: string; text: string; blIds: string[] } | null = null
  if (kind === 'ce_mercante_taxas') {
    if (!Number.isInteger(body.anchor_voyage_id) || Number(body.anchor_voyage_id) <= 0) {
      return json(422, { error: 'Viagem obrigatória para o comunicado financeiro.' }, origin)
    }
    const [{ data: readiness, error: readinessError }, { data: payload, error: payloadError }] = await Promise.all([
      admin.rpc('customer_local_charges_communication_readiness', {
        p_voyage_id: Number(body.anchor_voyage_id),
        p_customer_id: customerId,
      }),
      admin.rpc('customer_local_charges_communication_payload', {
        p_voyage_id: Number(body.anchor_voyage_id),
        p_customer_id: customerId,
      }),
    ])
    if (readinessError || payloadError) return json(500, { error: 'Não foi possível conferir os dados financeiros do comunicado.' }, origin)
    if (!(readiness as { ready?: boolean } | null)?.ready) return json(422, { error: 'Prontidão financeira bloqueada para este cliente e viagem.' }, origin)
    const row = payload as {
      customer_name?: string
      vessel_name?: string
      voyage_number?: string
      port?: string
      milestone_at?: string
      bls?: Array<{ bl_id?: string; ce_mercante?: string | null; total_brl?: number }>
    } | null
    if (!row?.customer_name || !row.vessel_name || !row.voyage_number || !Array.isArray(row.bls) || !row.bls.length) {
      return json(422, { error: 'Dados financeiros incompletos para o comunicado.' }, origin)
    }
    const rendered = renderCeMercanteTaxasTemplate({
      customerId,
      customerName: row.customer_name,
      vesselName: row.vessel_name,
      voyageNumber: row.voyage_number,
      port: row.port ?? '—',
      milestoneAt: row.milestone_at ?? '',
      bls: row.bls.map((bl) => ({ id: String(bl.bl_id ?? ''), customerId })),
      portalUrl: portalBillingUrl(),
      ceMercanteRows: row.bls.map((bl) => ({
        blId: String(bl.bl_id ?? ''),
        ceMercante: String(bl.ce_mercante ?? ''),
        totalBrl: Number(bl.total_brl ?? 0),
      })),
    })
    canonicalPayload = { subject: rendered.subject, html: rendered.html, text: rendered.text, blIds: rendered.blIds }
  }
  const effectiveSubject = canonicalPayload?.subject ?? subject
  const effectiveHtml = canonicalPayload?.html ?? html
  const effectiveText = canonicalPayload?.text ?? text
  const effectiveBlIds = canonicalPayload?.blIds ?? blIds
  const { data: contacts, error: contactsError } = await admin
    .from('customer_contacts')
    .select('id, customer_id, email')
    .eq('customer_id', customerId)
  if (contactsError) return json(500, { error: 'Não foi possível conferir o contato.' }, origin)
  const contact = ((contacts ?? []) as ContactRow[]).find((row) => normalizeEmail(row.email ?? '') === recipient)
  if (!contact) return json(422, { error: 'Destinatário não pertence ao cliente selecionado.' }, origin)

  const [{ data: preference, error: preferenceError }, { data: communicationSuppression, error: communicationSuppressionError }, { data: portalSuppression, error: portalSuppressionError }, { data: settings, error: settingsError }] = await Promise.all([
    admin.from('customer_contact_preferences').select('enabled').eq('contact_id', contact.id).eq('nature', nature).maybeSingle(),
    admin.from('customer_communication_suppressions').select('id').eq('email', recipient).maybeSingle(),
    admin.from('portal_suppressed_emails').select('id').eq('email', recipient).eq('reason', 'bounce_permanente').maybeSingle(),
    admin.from('app_settings').select('communications_enabled').eq('id', 1).single(),
  ])
  if (preferenceError || communicationSuppressionError || portalSuppressionError || settingsError) return json(500, { error: 'Não foi possível conferir as regras de envio.' }, origin)
  if (preference?.enabled === false) return json(422, { error: 'Contato desativado para esta natureza.' }, origin)
  if (communicationSuppression || portalSuppression) return json(422, { error: 'Endereço suprimido para Comunicados.', suppressed: true }, origin)

  let existingCommunicationId: number | null = null
  if (isAutomation) {
    try {
      existingCommunicationId = await findExistingCommunicationId(admin, {
        customerId,
        kind,
        nature,
        anchorVoyageId: body.anchor_voyage_id,
        anchorPort: body.anchor_port,
        anchorAtracacaoId: body.anchor_atracacao_id,
        anchorInvoiceId: body.anchor_invoice_id,
        attemptDiscriminator,
        dispatchId: body.dispatch_id,
      })
    } catch (error) {
      console.error('customer communication identity lookup failed', error)
      return json(500, { error: 'Não foi possível conferir o comunicado existente.' }, origin)
    }
  }

  const { data: communicationId, error: createError } = await admin.rpc('create_customer_communication_atomic', {
    p_customer_id: customerId,
    p_kind: kind,
    p_nature: nature,
    p_anchor_voyage_id: body.anchor_voyage_id ?? null,
    p_anchor_port: body.anchor_port ?? null,
    p_anchor_atracacao_id: body.anchor_atracacao_id ?? null,
    p_anchor_invoice_id: body.anchor_invoice_id ?? null,
    p_attempt_discriminator: attemptDiscriminator,
    p_dispatch_id: body.dispatch_id ?? null,
    p_vessel_name: body.vessel_name ?? null,
    p_voyage_number: body.voyage_number ?? null,
    p_terminal_name: body.terminal_name ?? null,
    p_created_by: callerUser.user?.id ?? null,
    p_bl_ids: effectiveBlIds,
  })
  if (createError || communicationId == null) {
    if (isUniqueViolation(createError)) return json(200, { status: 'simulado', message: 'Comunicado já registrado.' }, origin)
    console.error('customer communication atomic record failed', createError)
    return json(500, { error: 'Não foi possível registrar o comunicado.' }, origin)
  }

  if (isAutomation && existingCommunicationId == null) {
    const { error: originError } = await admin.from('customer_communications').update({ origin: 'automatico' }).eq('id', communicationId)
    if (originError) {
      console.error('customer communication origin persistence failed', originError)
      return json(500, { error: 'Não foi possível registrar a origem do comunicado.' }, origin)
    }
  }

  try {
    await persistCommunicationAttachments(admin, Number(communicationId), attachments, callerUser.user?.id ?? null)
  } catch (error) {
    await admin.from('customer_communications').update({ status: 'falha' }).eq('id', communicationId)
    console.error('customer communication attachment persistence failed', error)
    return json(500, { error: 'Não foi possível persistir os anexos do comunicado.' }, origin)
  }

  const enabled = Boolean((settings as { communications_enabled?: boolean } | null)?.communications_enabled)
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (enabled && !resendApiKey) {
    await admin.from('customer_communications').update({ status: 'falha' }).eq('id', communicationId)
    return json(500, { error: 'RESEND_API_KEY não está configurada para envio real.' }, origin)
  }

  let sent: { ok: boolean }
  try {
    sent = await sendEmail({
      kind,
      to: recipient,
      subject: effectiveSubject,
      html: effectiveHtml,
      text: effectiveText,
      attachments: emailAttachments,
      idempotencyKey: `comunicado:${communicationId}:${attemptDiscriminator}:${recipient}`,
      resendApiKey: enabled ? resendApiKey : null,
      from: Deno.env.get('PORTAL_FROM_EMAIL'),
      replyTo: Deno.env.get('COMMUNICATIONS_REPLY_TO'),
      missingConfigurationMessage: 'PORTAL_FROM_EMAIL e COMMUNICATIONS_REPLY_TO são obrigatórios para envio real',
      checkSuppression: async (to) => {
        const [{ data: complaint }, { data: bounce }] = await Promise.all([
          admin.from('customer_communication_suppressions').select('id').eq('email', to).maybeSingle(),
          admin.from('portal_suppressed_emails').select('id').eq('email', to).eq('reason', 'bounce_permanente').maybeSingle(),
        ])
        return { suppressed: Boolean(complaint || bounce) }
      },
      recordAttempt: async ({ kind: attemptKind, to, idempotencyKey }): Promise<EmailAttemptRecord> => {
        const { data, error } = await admin.from('customer_communication_attempts').insert({
          communication_id: communicationId,
          recipient_masked: maskEmail(to),
          status: 'aceito',
          idempotency_key: idempotencyKey,
        }).select('id').single()
        if (error?.code === '23505') {
          const { data: existing, error: existingError } = await admin
            .from('customer_communication_attempts')
            .select('id, status, provider_message_id')
            .eq('idempotency_key', idempotencyKey)
            .single()
          if (existingError || !existing) throw existingError ?? error
          return { id: existing.id, status: existing.status as EmailAttemptRecord['status'], providerMessageId: existing.provider_message_id, existing: true }
        }
        if (error || !data) throw error ?? new Error(`Não foi possível registrar a tentativa ${attemptKind}.`)
        return { id: data.id, status: 'aceito', providerMessageId: null, existing: false }
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
  } catch (error) {
    await admin.from('customer_communications').update({ status: 'falha' }).eq('id', communicationId)
    console.error('customer communication send failed', error)
    return json(500, { error: 'Falha no envio do comunicado.' }, origin)
  }

  const status = sent.ok ? (enabled ? 'enviado' : 'simulado') : 'falha'
  const { error: statusError } = await admin.from('customer_communications').update({ status }).eq('id', communicationId)
  if (statusError) {
    console.error('customer communication status persistence failed', statusError)
    return json(500, { error: 'Não foi possível persistir o status do comunicado.' }, origin)
  }
  const { data: attempt } = await admin
    .from('customer_communication_attempts')
    .select('id')
    .eq('communication_id', communicationId)
    .eq('idempotency_key', `comunicado:${communicationId}:${attemptDiscriminator}:${recipient}`)
    .maybeSingle()
  return json(sent.ok ? 200 : 502, {
    communicationId,
    attemptId: attempt?.id ?? undefined,
    status,
    suppressed: false,
    message: enabled ? 'Comunicado enviado.' : 'Comunicado registrado em simulação; nenhum e-mail foi enviado.',
  }, origin)
}

if (typeof Deno !== 'undefined') Deno.serve(withCors(handler))
