import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, withCors } from '../_shared/cors.ts'
import { maskEmail, sendEmail, type EmailAttachment } from '../_shared/email.ts'
import {
  assertValidCommunicationAttachments,
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
  uploadedBy: string,
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

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin')
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, origin)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'Configuração do Supabase ausente.' }, origin)

  const jwt = req.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(jwt)) return json(401, { error: 'Autenticação obrigatória.' }, origin)

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: jwt } } })
  const { data: role, error: roleError } = await caller.rpc('portal_current_role')
  if (roleError || !['administrativo', 'documentacao', 'equipamentos'].includes(String(role))) {
    return json(403, { error: 'Sem permissão para Comunicados.' }, origin)
  }
  const { data: callerUser } = await caller.auth.getUser()
  if (!callerUser.user) return json(401, { error: 'Sessão inválida.' }, origin)

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
  if (!subject || !html || !text) return json(422, { error: 'Assunto e conteúdo do comunicado são obrigatórios.' }, origin)
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
    p_created_by: callerUser.user.id,
    p_bl_ids: blIds,
  })
  if (createError || communicationId == null) {
    if (isUniqueViolation(createError)) return json(200, { status: 'simulado', message: 'Comunicado já registrado.' }, origin)
    console.error('customer communication atomic record failed', createError)
    return json(500, { error: 'Não foi possível registrar o comunicado.' }, origin)
  }

  try {
    await persistCommunicationAttachments(admin, Number(communicationId), attachments, callerUser.user.id)
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
      subject,
      html,
      text,
      attachments: emailAttachments,
      idempotencyKey: String(body.idempotency_key ?? `comunicado:${communicationId}:${attemptDiscriminator}`),
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
      recordAttempt: async ({ kind: attemptKind, to, idempotencyKey }) => {
        const { data, error } = await admin.from('customer_communication_attempts').insert({
          communication_id: communicationId,
          recipient_masked: maskEmail(to),
          status: 'aceito',
          idempotency_key: idempotencyKey,
        }).select('id').single()
        if (error || !data) throw error ?? new Error(`Não foi possível registrar a tentativa ${attemptKind}.`)
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
  } catch (error) {
    await admin.from('customer_communications').update({ status: 'falha' }).eq('id', communicationId)
    console.error('customer communication send failed', error)
    return json(500, { error: 'Falha no envio do comunicado.' }, origin)
  }

  const status = sent.ok ? (enabled ? 'enviado' : 'simulado') : 'falha'
  await admin.from('customer_communications').update({ status }).eq('id', communicationId)
  const { data: attempt } = await admin
    .from('customer_communication_attempts')
    .select('id')
    .eq('communication_id', communicationId)
    .eq('idempotency_key', String(body.idempotency_key ?? `comunicado:${communicationId}:${attemptDiscriminator}`))
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
