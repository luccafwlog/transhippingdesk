export const CUSTOMER_COMMUNICATION_KINDS = [
  'aviso_chegada_noa',
  'aviso_prontidao_nor',
  'aviso_atracacao_nob',
  'institucional',
  'livre',
] as const

export type CustomerCommunicationKind = typeof CUSTOMER_COMMUNICATION_KINDS[number]
export type CustomerCommunicationNature = 'avisos_gerais' | 'avisos_operacionais' | 'documentacao' | 'demurrage'

export const CUSTOMER_COMMUNICATION_MILESTONE_KINDS = [
  'aviso_chegada_noa',
  'aviso_prontidao_nor',
  'aviso_atracacao_nob',
] as const

export type CustomerCommunicationBlScope = {
  id: string
  customerId: number
  terminalId?: string | null
  terminalStateId?: string | null
}

export type CustomerCommunicationTemplateInput = {
  customerId: number
  customerName: string
  vesselName: string
  voyageNumber: string
  port: string
  terminalName?: string | null
  terminalId?: string | null
  terminalStateId?: string | null
  milestoneAt: string
  bls: readonly CustomerCommunicationBlScope[]
  subject?: string
  body?: string
}

export type RenderedCustomerCommunication = {
  kind: CustomerCommunicationKind
  subject: string
  html: string
  text: string
  customerId: number
  blIds: string[]
  terminalId: string | null
}

export type CommunicationAttachment = {
  filename: string
  contentType: string
  size: number
  contentBase64?: string
}

export type AttachmentValidationResult = {
  valid: boolean
  totalBytes: number
  errors: string[]
}

export const COMMUNICATION_ATTACHMENT_MAX_FILES = 3
export const COMMUNICATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const COMMUNICATION_ATTACHMENT_ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain',
] as const

const COMMUNICATION_ATTACHMENT_ALLOWED_TYPE_SET = new Set<string>(COMMUNICATION_ATTACHMENT_ALLOWED_TYPES)
const FORBIDDEN_ATTACHMENT_KINDS = new Set(['ce_mercante_taxas', 'cobranca_demurrage'])
const BRASILIA_TIME_ZONE = 'America/Sao_Paulo'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function clean(value: string | null | undefined, fallback = '—'): string {
  const result = value?.trim()
  return result || fallback
}

function formatDateOnly(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  return `${match[3]}/${match[2]}/${match[1]}`
}

/** Formata timestamps de comunicados no fuso oficial da operação. */
export function formatCommunicationDateTime(value: string | null | undefined): string {
  if (!value?.trim()) return '—'
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${formatDateOnly(trimmed)} (horário de Brasília)`
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed

  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: BRASILIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(parsed)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.day}/${byType.month}/${byType.year} às ${byType.hour}:${byType.minute} (horário de Brasília)`
}

// Alias curto para callers da Edge Function e para manter o nome próximo ao
// helper legado de datas sem importar código específico do navegador.
export const formatDateTimeBRForCommunication = formatCommunicationDateTime

function assertCommunicationScope(input: CustomerCommunicationTemplateInput, kind: CustomerCommunicationKind): void {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new Error('Cliente inválido para o comunicado.')
  }
  if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  if (!input.vesselName.trim()) throw new Error('Navio ausente.')
  if (!input.voyageNumber.trim()) throw new Error('Viagem ausente.')
  if (!input.port.trim()) throw new Error('Porto ausente.')
  if (CUSTOMER_COMMUNICATION_MILESTONE_KINDS.includes(kind as typeof CUSTOMER_COMMUNICATION_MILESTONE_KINDS[number]) && !input.milestoneAt.trim()) {
    throw new Error('Data do marco operacional ausente.')
  }
  if (kind !== 'institucional' && !input.bls.length) throw new Error('O comunicado precisa de ao menos um B/L vinculado.')

  for (const bl of input.bls) {
    if (!bl.id.trim()) throw new Error('B/L inválido no comunicado.')
    if (bl.customerId !== input.customerId) {
      throw new Error('B/L de outro cliente não pode entrar no comunicado.')
    }
    if (kind === 'aviso_atracacao_nob') {
      const expectedTerminalIdentity = input.terminalStateId?.trim() || input.terminalId?.trim()
      const blTerminalIdentity = bl.terminalStateId?.trim() || bl.terminalId?.trim()
      if (blTerminalIdentity !== expectedTerminalIdentity) {
        throw new Error('B/L de outro terminal não pode entrar no NOB.')
      }
    }
  }

  if (kind === 'aviso_atracacao_nob') {
    if (!input.terminalId?.trim()) throw new Error('Identidade do terminal ausente para o NOB.')
    if (!input.terminalName?.trim()) throw new Error('Terminal ausente para o NOB.')
  }
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#f4f7fb;color:#172033;font-family:Arial,Helvetica,sans-serif"><div style="max-width:680px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;overflow:hidden"><header style="background:#0f2747;color:#fff;padding:22px 28px"><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">Transhipping Desk</div><h1 style="margin:8px 0 0;font-size:22px;line-height:1.25">${escapeHtml(title)}</h1></header><main style="padding:28px;line-height:1.6">${bodyHtml}</main><footer style="padding:18px 28px;border-top:1px solid #e5eaf1;color:#667085;font-size:12px">Mensagem operacional enviada pelo Transhipping Desk. Em caso de dúvida, responda a este e-mail para falar com a equipe.</footer></div></body></html>`
}

function textLayout(title: string, body: string): string {
  return `Transhipping Desk\n${title}\n\n${body}\n\nMensagem operacional enviada pelo Transhipping Desk. Em caso de dúvida, responda a este e-mail para falar com a equipe.`
}

function renderMilestoneContent(
  input: CustomerCommunicationTemplateInput,
  kind: CustomerCommunicationKind,
  title: string,
  sentenceHtml: string,
  sentenceText: string,
): RenderedCustomerCommunication {
  const blIds = input.bls.map((bl) => bl.id.trim())
  const customer = clean(input.customerName)
  const bodyText = `Olá, ${customer}.\n\n${sentenceText}\n\nB/Ls relacionados: ${blIds.join(', ')}.`
  const bodyHtml = `<p>Olá, ${escapeHtml(customer)}.</p><p>${sentenceHtml}</p><p><strong>B/Ls relacionados:</strong> ${blIds.map(escapeHtml).join(', ')}</p>`
  return {
    kind,
    subject: title,
    html: layout(title, bodyHtml),
    text: textLayout(title, bodyText),
    customerId: input.customerId,
    blIds,
    terminalId: input.terminalId ?? null,
  }
}

export function renderNoaTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_chegada_noa')
  const port = clean(input.port)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const milestone = formatCommunicationDateTime(input.milestoneAt)
  const subject = `Notice of Arrival / Aviso de Chegada — ${vessel} / ${voyage} — Porto de ${port}`
  return renderMilestoneContent(
    input,
    'aviso_chegada_noa',
    subject,
    `O navio <strong>${escapeHtml(vessel)}</strong>, viagem <strong>${escapeHtml(voyage)}</strong>, tem chegada prevista para <strong>${escapeHtml(milestone)}</strong> no Porto de ${escapeHtml(port)}.`,
    `O navio ${vessel}, viagem ${voyage}, tem chegada prevista para ${milestone} no Porto de ${port}.`,
  )
}

export function renderNorTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_prontidao_nor')
  const port = clean(input.port)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const milestone = formatCommunicationDateTime(input.milestoneAt)
  const subject = `Notice of Readiness / Prontidão de Descarga — ${vessel} / ${voyage} — Porto de ${port}`
  const sentenceHtml = `Registramos a prontidão de descarga do navio <strong>${escapeHtml(vessel)}</strong>, viagem <strong>${escapeHtml(voyage)}</strong>, em <strong>${escapeHtml(milestone)}</strong> no Porto de ${escapeHtml(port)}.`
  const sentenceText = `Registramos a prontidão de descarga do navio ${vessel}, viagem ${voyage}, em ${milestone} no Porto de ${port}.`
  return renderMilestoneContent(input, 'aviso_prontidao_nor', subject, sentenceHtml, sentenceText)
}

export function renderNobTemplate(input: CustomerCommunicationTemplateInput): RenderedCustomerCommunication {
  assertCommunicationScope(input, 'aviso_atracacao_nob')
  const port = clean(input.port)
  const vessel = clean(input.vesselName)
  const voyage = clean(input.voyageNumber)
  const terminal = clean(input.terminalName)
  const milestone = formatCommunicationDateTime(input.milestoneAt)
  const subject = `Notice of Berthing / Aviso de Atracação — ${vessel} / ${voyage} — Porto de ${port} (${terminal})`
  const sentenceHtml = `O navio <strong>${escapeHtml(vessel)}</strong>, viagem <strong>${escapeHtml(voyage)}</strong>, atracou em <strong>${escapeHtml(milestone)}</strong> no terminal ${escapeHtml(terminal)}, Porto de ${escapeHtml(port)}.`
  const sentenceText = `O navio ${vessel}, viagem ${voyage}, atracou em ${milestone} no terminal ${terminal}, Porto de ${port}.`
  return renderMilestoneContent(input, 'aviso_atracacao_nob', subject, sentenceHtml, sentenceText)
}

export function renderInstitutionalTemplate(input: CustomerCommunicationTemplateInput, kind: 'institucional' | 'livre' = 'institucional'): RenderedCustomerCommunication {
  if (kind === 'livre') assertCommunicationScope(input, kind)
  else {
    if (!Number.isInteger(input.customerId) || input.customerId <= 0) throw new Error('Cliente inválido para o comunicado.')
    if (!input.customerName.trim()) throw new Error('Nome do cliente ausente.')
  }
  if (kind === 'institucional' && input.bls.length) throw new Error('Comunicado institucional não pode conter B/Ls.')
  const subject = clean(input.subject, 'Comunicado Transhipping Desk')
  const body = clean(input.body, '')
  const safeBodyHtml = escapeHtml(body).replace(/\n/g, '<br>')
  const bodyText = `Olá, ${clean(input.customerName)}.\n\n${body}`
  return {
    kind,
    subject,
    html: layout(subject, `<p>Olá, ${escapeHtml(clean(input.customerName))}.</p><p>${safeBodyHtml}</p>`),
    text: textLayout(subject, bodyText),
    customerId: input.customerId,
    blIds: input.bls.map((bl) => bl.id.trim()),
    terminalId: input.terminalId ?? null,
  }
}

export function renderCustomerCommunicationTemplate(
  kind: CustomerCommunicationKind,
  input: CustomerCommunicationTemplateInput,
): RenderedCustomerCommunication {
  switch (kind) {
    case 'aviso_chegada_noa': return renderNoaTemplate(input)
    case 'aviso_prontidao_nor': return renderNorTemplate(input)
    case 'aviso_atracacao_nob': return renderNobTemplate(input)
    case 'institucional': return renderInstitutionalTemplate(input, 'institucional')
    case 'livre': return renderInstitutionalTemplate(input, 'livre')
  }
}

export const renderNoa = renderNoaTemplate
export const renderNor = renderNorTemplate
export const renderNob = renderNobTemplate

export function validateCommunicationAttachments(
  kind: string,
  attachments: readonly CommunicationAttachment[] | null | undefined,
): AttachmentValidationResult {
  const files = attachments ?? []
  const errors: string[] = []
  const totalBytes = files.reduce((sum, file) => sum + (Number.isFinite(file.size) ? Math.max(0, file.size) : 0), 0)

  if (FORBIDDEN_ATTACHMENT_KINDS.has(kind)) {
    errors.push('Anexos não são permitidos para cobrança local ou cobrança de demurrage.')
  }
  if (files.length > COMMUNICATION_ATTACHMENT_MAX_FILES) {
    errors.push(`O limite é de ${COMMUNICATION_ATTACHMENT_MAX_FILES} anexos por comunicado.`)
  }
  if (totalBytes > COMMUNICATION_ATTACHMENT_MAX_BYTES) {
    errors.push('O tamanho total dos anexos não pode ultrapassar 10 MB.')
  }

  files.forEach((file, index) => {
    if (!file.filename.trim()) errors.push(`O anexo ${index + 1} precisa de nome.`)
    if (!COMMUNICATION_ATTACHMENT_ALLOWED_TYPE_SET.has(file.contentType.toLowerCase())) {
      errors.push(`Tipo não permitido no anexo ${index + 1}: ${file.contentType || 'ausente'}.`)
    }
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > COMMUNICATION_ATTACHMENT_MAX_BYTES) {
      errors.push(`Tamanho inválido no anexo ${index + 1}.`)
    }
  })

  return { valid: errors.length === 0, totalBytes, errors }
}

export function assertValidCommunicationAttachments(
  kind: string,
  attachments: readonly CommunicationAttachment[] | null | undefined,
): void {
  const result = validateCommunicationAttachments(kind, attachments)
  if (!result.valid) throw new Error(result.errors.join(' '))
}

export const validateAttachments = validateCommunicationAttachments
