import type {
  CustomerCommunicationNature,
  CustomerContact,
  CustomerContactPreference,
} from '../types/database'
import { canonicalizeDocument } from '../lib/cnpj'
import { listVoyageEscalaSchedulesByVoyageIds, type VoyageEscalaSchedule } from './voyageRouteSchedules'
import { supabase } from './supabase'
import type { CustomerCommunicationKind, CustomerCommunicationTemplateInput } from './customerCommunicationTemplates'

export const CUSTOMER_COMMUNICATION_NATURES: readonly CustomerCommunicationNature[] = [
  'avisos_gerais',
  'avisos_operacionais',
  'documentacao',
  'demurrage',
]

export type CustomerCommunicationExcludedReason =
  | 'preferencia_desligada'
  | 'email_ausente'
  | 'suprimido_complaint'
  | 'suprimido_bounce'

export type EmailSuppressionRow = {
  email: string
  reason?: string | null
}

export type RecipientSuppressionChannel = 'portal' | 'comunicados'

type SuppressionLookupInput = {
  channel: RecipientSuppressionChannel
  sharedSuppressions?: readonly EmailSuppressionRow[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
}

export type ExcludedCustomerCommunicationRecipient = {
  contact: CustomerContact
  reason: CustomerCommunicationExcludedReason
}

export type CustomerCommunicationRecipients = {
  eligible: CustomerContact[]
  excluded: ExcludedCustomerCommunicationRecipient[]
  blocked: boolean
}

type Preference = Pick<CustomerContactPreference, 'contact_id' | 'nature' | 'enabled'>

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase()
}

function hasSuppression(
  email: string,
  suppressions: readonly EmailSuppressionRow[] | undefined,
  reason?: string,
): boolean {
  return (suppressions ?? []).some((suppression) =>
    normalizedEmail(suppression.email) === email &&
    (reason === undefined || suppression.reason === reason),
  )
}

export function getEmailSuppressionReason(
  email: string,
  input: SuppressionLookupInput,
): 'bounce_permanente' | 'complaint' | null {
  const normalized = normalizedEmail(email)

  // Bounce is global because the mailbox does not exist. A legacy complaint
  // row in the shared Portal table must not leak into Comunicados: complaints
  // are channel-specific from this foundation onward.
  if (hasSuppression(normalized, input.sharedSuppressions, 'bounce_permanente')) {
    return 'bounce_permanente'
  }

  if (
    input.channel === 'comunicados' &&
    hasSuppression(normalized, input.communicationSuppressions, 'complaint')
  ) {
    return 'complaint'
  }

  if (
    input.channel === 'portal' &&
    hasSuppression(normalized, input.sharedSuppressions, 'complaint')
  ) {
    return 'complaint'
  }

  return null
}

export function resolveCustomerCommunicationRecipients(input: {
  contacts: readonly CustomerContact[]
  nature: CustomerCommunicationNature
  preferences: readonly Preference[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
  portalSuppressions?: readonly EmailSuppressionRow[]
}): CustomerCommunicationRecipients {
  const preferences = new Map(
    input.preferences
      .filter((preference) => preference.nature === input.nature)
      .map((preference) => [preference.contact_id, preference.enabled]),
  )
  const eligible: CustomerContact[] = []
  const excluded: ExcludedCustomerCommunicationRecipient[] = []

  for (const contact of input.contacts) {
    if (preferences.get(contact.id) === false) {
      excluded.push({ contact, reason: 'preferencia_desligada' })
      continue
    }

    const email = contact.email?.trim()
    if (!email) {
      excluded.push({ contact, reason: 'email_ausente' })
      continue
    }

    const suppression = getEmailSuppressionReason(email, {
      channel: 'comunicados',
      sharedSuppressions: input.portalSuppressions,
      communicationSuppressions: input.communicationSuppressions,
    })
    if (suppression === 'complaint') {
      excluded.push({ contact, reason: 'suprimido_complaint' })
      continue
    }
    if (suppression === 'bounce_permanente') {
      excluded.push({ contact, reason: 'suprimido_bounce' })
      continue
    }

    eligible.push(contact)
  }

  return { eligible, excluded, blocked: eligible.length === 0 }
}

export type CustomerCommunicationDispatchMode = 'carga' | 'institucional'

export type CustomerCommunicationFilters = {
  mode: CustomerCommunicationDispatchMode
  vessel: string
  voyage: string
  scale: string
  pod: string
  pol: string
  cnpj: string
}

export const DEFAULT_CUSTOMER_COMMUNICATION_FILTERS: CustomerCommunicationFilters = {
  mode: 'carga',
  vessel: '',
  voyage: '',
  scale: '',
  pod: '',
  pol: '',
  cnpj: '',
}

export const OPERATIONAL_CUSTOMER_COMMUNICATION_FILTERS = ['vessel', 'voyage', 'scale', 'pod', 'pol'] as const

export type CustomerCommunicationBlCandidate = {
  id: string
  customerId: number
  customerName: string
  customerCnpj: string
  voyageId: number
  vesselName: string
  voyageNumber: string
  pod: string
  pol: string
  cargoMode: string
  eta: string | null
  ata: string | null
  scaleNumber: string | null
  terminalId: string | null
  terminalName: string | null
  terminalStateId: string | null
  milestoneAt: string | null
}

export type CustomerCommunicationHistoryMatch = {
  customerId: number
  kind: string
  anchorVoyageId: number | null
  anchorPort: string | null
  anchorAtracacaoId: string | null
  anchorInvoiceId: number | null
  attemptDiscriminator: number
}

export type CustomerCommunicationConferenceRow = {
  key: string
  customerId: number
  customerName: string
  customerCnpj: string
  terminalId: string | null
  terminalName: string | null
  bls: CustomerCommunicationBlCandidate[]
  sourceBls: CustomerCommunicationBlCandidate[]
  eligibleRecipients: CustomerContact[]
  excludedRecipients: ExcludedCustomerCommunicationRecipient[]
  blocked: boolean
  selected: boolean
  nextAttemptDiscriminator: number
  renderInput: CustomerCommunicationTemplateInput
}

export type CustomerCommunicationConference = {
  kind: CustomerCommunicationKind
  nature: CustomerCommunicationNature
  mode: CustomerCommunicationDispatchMode
  rows: CustomerCommunicationConferenceRow[]
  totalCustomers: number
  totalEligibleEmails: number
  totalExcludedEmails: number
  blockedCustomers: CustomerCommunicationConferenceRow[]
  excludedReasonCounts: Record<CustomerCommunicationExcludedReason, number>
}

export type CommunicationFilterValidation = {
  valid: boolean
  message: string | null
}

function cleanFilter(value: string | null | undefined): string {
  return value?.trim() ?? ''
}

function normalizedUpper(value: string | null | undefined): string {
  return cleanFilter(value).toUpperCase()
}

function matchesFilter(value: string | null | undefined, filter: string): boolean {
  const normalizedFilter = normalizedUpper(filter)
  if (!normalizedFilter) return true
  return normalizedUpper(value).includes(normalizedFilter)
}

function samePort(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizedUpper(left)
  const b = normalizedUpper(right)
  return Boolean(a && b && a === b)
}

export function validateCustomerCommunicationFilters(filters: CustomerCommunicationFilters): CommunicationFilterValidation {
  if (filters.mode === 'institucional') return { valid: true, message: null }
  const hasOperationalFilter = OPERATIONAL_CUSTOMER_COMMUNICATION_FILTERS.some((key) => Boolean(cleanFilter(filters[key])))
  return hasOperationalFilter
    ? { valid: true, message: null }
    : { valid: false, message: 'No modo carga, informe ao menos um filtro operacional: navio, viagem, escala, POD ou POL.' }
}

export function filterCustomerCommunicationBls(
  rows: readonly CustomerCommunicationBlCandidate[],
  filters: CustomerCommunicationFilters,
): CustomerCommunicationBlCandidate[] {
  return rows.filter((row) => {
    if (filters.mode === 'carga') {
      if (!matchesFilter(row.vesselName, filters.vessel)) return false
      if (!matchesFilter(row.voyageNumber, filters.voyage)) return false
      if (!matchesFilter(row.scaleNumber, filters.scale)) return false
      if (!matchesFilter(row.pod, filters.pod)) return false
      if (!matchesFilter(row.pol, filters.pol)) return false
    }
    if (cleanFilter(filters.cnpj) && canonicalizeDocument(row.customerCnpj) !== canonicalizeDocument(filters.cnpj)) return false
    return true
  })
}

function subtractMonths(value: Date, months: number): Date {
  const result = new Date(value.getTime())
  result.setUTCMonth(result.getUTCMonth() - months)
  return result
}

/** Cliente comunicável tem carga recente; carga futura também é válida. */
export function isInstitutionalCustomerCommunicable(
  rows: readonly CustomerCommunicationBlCandidate[],
  now = new Date(),
): boolean {
  const lowerBound = subtractMonths(now, 12).getTime()
  return rows.some((row) => {
    if (!row.eta) return false
    const eta = new Date(row.eta).getTime()
    return !Number.isNaN(eta) && eta >= lowerBound
  })
}

function communicationNatureForKind(kind: CustomerCommunicationKind, nature?: CustomerCommunicationNature): CustomerCommunicationNature {
  if (kind === 'aviso_chegada_noa' || kind === 'aviso_prontidao_nor' || kind === 'aviso_atracacao_nob') return 'avisos_operacionais'
  if (kind === 'ce_mercante_taxas') return 'documentacao'
  if (kind === 'cobranca_demurrage') return 'demurrage'
  if (kind === 'institucional') return 'avisos_gerais'
  return nature ?? 'avisos_gerais'
}

export function getCustomerCommunicationNature(kind: CustomerCommunicationKind, nature?: CustomerCommunicationNature): CustomerCommunicationNature {
  return communicationNatureForKind(kind, nature)
}

function candidateIdentity(row: CustomerCommunicationBlCandidate, kind: CustomerCommunicationKind): string {
  if (kind === 'institucional' || kind === 'livre') return String(row.customerId)
  if (kind === 'aviso_atracacao_nob') {
    return `${row.customerId}:${row.voyageId}:${normalizedUpper(row.pod)}:${row.terminalStateId ?? 'terminal-state-sem-identidade'}`
  }
  return `${row.customerId}:${row.voyageId}:${normalizedUpper(row.pod)}`
}

function historyMatchesRow(
  history: CustomerCommunicationHistoryMatch,
  row: { customerId: number; terminalStateId: string | null; pod: string; voyageId: number },
  kind: CustomerCommunicationKind,
): boolean {
  return history.kind === kind
    && history.customerId === row.customerId
    && history.anchorVoyageId === row.voyageId
    && samePort(history.anchorPort, row.pod)
    && (kind !== 'aviso_atracacao_nob' || history.anchorAtracacaoId === row.terminalStateId)
}

function nextAttemptDiscriminator(
  rows: readonly CustomerCommunicationHistoryMatch[],
  candidate: CustomerCommunicationBlCandidate,
  kind: CustomerCommunicationKind,
): number {
  const matching = rows.filter((history) => historyMatchesRow(history, candidate, kind))
  if (!matching.length) return 0
  return Math.max(...matching.map((history) => history.attemptDiscriminator)) + 1
}

function nextInstitutionalAttemptDiscriminator(
  rows: readonly CustomerCommunicationHistoryMatch[],
  customerId: number,
  kind: CustomerCommunicationKind,
): number {
  const matching = rows.filter((history) => history.kind === kind && history.customerId === customerId)
  if (!matching.length) return 0
  return Math.max(...matching.map((history) => history.attemptDiscriminator)) + 1
}

function makeRenderInput(
  row: CustomerCommunicationBlCandidate,
  bls: readonly CustomerCommunicationBlCandidate[],
  institutional: boolean,
): CustomerCommunicationTemplateInput {
  return {
    customerId: row.customerId,
    customerName: row.customerName,
    vesselName: row.vesselName,
    voyageNumber: row.voyageNumber,
    port: row.pod,
    terminalName: row.terminalName,
    terminalId: row.terminalId,
    terminalStateId: row.terminalStateId,
    milestoneAt: row.milestoneAt ?? row.eta ?? '',
    bls: institutional
      ? []
      : bls.map((bl) => ({
        id: bl.id,
        customerId: bl.customerId,
        terminalId: bl.terminalId,
        terminalStateId: bl.terminalStateId,
      })),
  }
}

export function buildCustomerCommunicationConference(input: {
  kind: CustomerCommunicationKind
  nature?: CustomerCommunicationNature
  mode: CustomerCommunicationDispatchMode
  candidates: readonly CustomerCommunicationBlCandidate[]
  contactsByCustomer: ReadonlyMap<number, readonly CustomerContact[]>
  preferences: readonly Preference[]
  communicationSuppressions?: readonly EmailSuppressionRow[]
  portalSuppressions?: readonly EmailSuppressionRow[]
  history?: readonly CustomerCommunicationHistoryMatch[]
  now?: Date
}): CustomerCommunicationConference {
  const nature = communicationNatureForKind(input.kind, input.nature)
  const grouped = new Map<string, CustomerCommunicationBlCandidate[]>()

  for (const candidate of input.candidates) {
    const key = candidateIdentity(candidate, input.kind)
    const current = grouped.get(key) ?? []
    if (!current.some((existing) => existing.id === candidate.id && existing.terminalStateId === candidate.terminalStateId)) current.push(candidate)
    grouped.set(key, current)
  }

  const rows: CustomerCommunicationConferenceRow[] = []
  for (const candidates of grouped.values()) {
    const first = candidates[0]
    if (!first) continue
    const sourceBls = candidates.slice()
    const institutional = input.kind === 'institucional'
    if (institutional && !isInstitutionalCustomerCommunicable(sourceBls, input.now)) continue
    const recipients = resolveCustomerCommunicationRecipients({
      contacts: [...(input.contactsByCustomer.get(first.customerId) ?? [])],
      nature,
      preferences: input.preferences.filter((preference) => input.contactsByCustomer.get(first.customerId)?.some((contact) => contact.id === preference.contact_id)),
      communicationSuppressions: input.communicationSuppressions,
      portalSuppressions: input.portalSuppressions,
    })
    const anchorRow = institutional ? { ...first, milestoneAt: null } : first
    rows.push({
      key: `${input.kind}:${candidateIdentity(first, input.kind)}`,
      customerId: first.customerId,
      customerName: first.customerName,
      customerCnpj: first.customerCnpj,
      terminalId: input.kind === 'aviso_atracacao_nob' ? first.terminalId : null,
      terminalName: input.kind === 'aviso_atracacao_nob' ? first.terminalName : null,
      bls: institutional ? [] : candidates,
      sourceBls,
      eligibleRecipients: recipients.eligible,
      excludedRecipients: recipients.excluded,
      blocked: recipients.blocked,
      selected: !recipients.blocked,
      nextAttemptDiscriminator: input.kind === 'institucional' || input.kind === 'livre'
        ? nextInstitutionalAttemptDiscriminator(input.history ?? [], first.customerId, input.kind)
        : nextAttemptDiscriminator(input.history ?? [], first, input.kind),
      renderInput: makeRenderInput(anchorRow, candidates, institutional),
    })
  }

  const excludedReasonCounts: Record<CustomerCommunicationExcludedReason, number> = {
    preferencia_desligada: 0,
    email_ausente: 0,
    suprimido_complaint: 0,
    suprimido_bounce: 0,
  }
  for (const row of rows) for (const excluded of row.excludedRecipients) excludedReasonCounts[excluded.reason] += 1

  return {
    kind: input.kind,
    nature,
    mode: input.mode,
    rows,
    totalCustomers: new Set(rows.map((row) => row.customerId)).size,
    totalEligibleEmails: rows.reduce((sum, row) => sum + row.eligibleRecipients.length, 0),
    totalExcludedEmails: rows.reduce((sum, row) => sum + row.excludedRecipients.length, 0),
    blockedCustomers: rows.filter((row) => row.blocked),
    excludedReasonCounts,
  }
}

type RawCommunicationBlRow = {
  id: string
  voyage_id: number
  customer_id: number | null
  pod: string | null
  pol: string | null
  cargo_mode: string
  customer: { id: number; name: string; cnpj_cpf: string } | null
  voyage: { id: number; voyage_number: string; eta: string | null; ata: string | null; vessel: { name: string } | null } | null
}

function toBaseCandidate(row: RawCommunicationBlRow): CustomerCommunicationBlCandidate | null {
  if (!row.customer_id || !row.customer || !row.voyage) return null
  if (!row.pod?.trim()) return null
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer.name,
    customerCnpj: row.customer.cnpj_cpf,
    voyageId: row.voyage_id,
    vesselName: row.voyage.vessel?.name ?? '',
    voyageNumber: row.voyage.voyage_number,
    pod: row.pod,
    pol: row.pol ?? '',
    cargoMode: row.cargo_mode,
    eta: row.voyage.eta,
    ata: row.voyage.ata,
    scaleNumber: null,
    terminalId: null,
    terminalName: null,
    terminalStateId: null,
    milestoneAt: null,
  }
}

function scheduleForCandidate(row: CustomerCommunicationBlCandidate, schedules: readonly VoyageEscalaSchedule[]): VoyageEscalaSchedule | null {
  return schedules.find((schedule) => samePort(schedule.port, row.pod)) ?? null
}

function expandCandidatesForKind(
  rows: readonly CustomerCommunicationBlCandidate[],
  schedulesByVoyage: ReadonlyMap<number, readonly VoyageEscalaSchedule[]>,
  kind: CustomerCommunicationKind,
): CustomerCommunicationBlCandidate[] {
  const expanded: CustomerCommunicationBlCandidate[] = []
  for (const row of rows) {
    const schedule = scheduleForCandidate(row, schedulesByVoyage.get(row.voyageId) ?? [])
    if (kind === 'livre') {
      if (schedule?.deleted || schedule?.omitted) continue
      expanded.push({
        ...row,
        scaleNumber: schedule?.escalaNumber ?? null,
        eta: schedule?.eta ?? row.eta,
        ata: schedule?.ata ?? row.ata,
        milestoneAt: null,
      })
      continue
    }
    if (!schedule || schedule.deleted || schedule.omitted) continue
    if (kind === 'aviso_atracacao_nob') {
      for (const atracacao of schedule.atracacoes) {
        // NOB is anchored by the state row UUID, never by the terminal UUID.
        // A missing state identity is not safe to turn into a dispatch.
        if (!atracacao.terminalId || !atracacao.stateId || !atracacao.atb) continue
        expanded.push({
          ...row,
          scaleNumber: schedule?.escalaNumber ?? null,
          terminalId: atracacao.terminalId,
          terminalName: atracacao.terminalCode ?? atracacao.terminalId,
          terminalStateId: atracacao.stateId,
          milestoneAt: atracacao.atb,
        })
      }
      continue
    }

    const milestoneAt = kind === 'aviso_prontidao_nor' ? schedule.ata : schedule.eta
    if (!milestoneAt) continue
    expanded.push({
      ...row,
      scaleNumber: schedule.escalaNumber ?? null,
      eta: schedule.eta,
      ata: schedule.ata,
      milestoneAt,
    })
  }
  return expanded
}

async function fetchCommunicationBlRows(): Promise<RawCommunicationBlRow[]> {
  const rows: RawCommunicationBlRow[] = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from('bls')
      .select('id, voyage_id, customer_id, pod, pol, cargo_mode, customer:customers!bls_customer_id_fkey(id, name, cnpj_cpf), voyage:voyages(id, voyage_number, eta, ata, vessel:vessels(name))')
      .order('id', { ascending: true })
      .range(from, from + 499)
      .overrideTypes<RawCommunicationBlRow[], { merge: false }>()
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 500) break
  }
  return rows
}

async function fetchCommunicationContacts(customerIds: readonly number[]): Promise<{
  contactsByCustomer: Map<number, CustomerContact[]>
  preferences: CustomerContactPreference[]
}> {
  const contactsByCustomer = new Map<number, CustomerContact[]>()
  const preferences: CustomerContactPreference[] = []
  for (let from = 0; from < customerIds.length; from += 100) {
    const ids = customerIds.slice(from, from + 100)
    const { data: contacts, error: contactsError } = await supabase.from('customer_contacts').select('*').in('customer_id', ids)
    if (contactsError) throw contactsError
    for (const contact of contacts ?? []) {
      if (contact.customer_id == null) continue
      const list = contactsByCustomer.get(contact.customer_id) ?? []
      list.push(contact)
      contactsByCustomer.set(contact.customer_id, list)
    }
  }
  const contactIds = [...contactsByCustomer.values()].flatMap((contacts) => contacts.map((contact) => contact.id))
  for (let from = 0; from < contactIds.length; from += 100) {
    const { data, error } = await supabase.from('customer_contact_preferences').select('*').in('contact_id', contactIds.slice(from, from + 100))
    if (error) throw error
    preferences.push(...(data ?? []))
  }
  return { contactsByCustomer, preferences }
}

async function fetchCommunicationHistory(customerIds: readonly number[], kind: CustomerCommunicationKind): Promise<CustomerCommunicationHistoryMatch[]> {
  if (!customerIds.length) return []
  const history: CustomerCommunicationHistoryMatch[] = []
  for (let from = 0; from < customerIds.length; from += 100) {
    const { data, error } = await supabase
      .from('customer_communications')
      .select('customer_id, kind, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, attempt_discriminator')
      .eq('kind', kind)
      .in('customer_id', customerIds.slice(from, from + 100))
    if (error) throw error
    history.push(...(data ?? []).map((row) => ({
      customerId: row.customer_id,
      kind: row.kind,
      anchorVoyageId: row.anchor_voyage_id,
      anchorPort: row.anchor_port,
      anchorAtracacaoId: row.anchor_atracacao_id,
      anchorInvoiceId: row.anchor_invoice_id,
      attemptDiscriminator: row.attempt_discriminator,
    })))
  }
  return history
}

export async function fetchCustomerCommunicationConference(input: {
  filters: CustomerCommunicationFilters
  kind: CustomerCommunicationKind
  nature?: CustomerCommunicationNature
  now?: Date
}): Promise<CustomerCommunicationConference> {
  const validation = validateCustomerCommunicationFilters(input.filters)
  if (!validation.valid) throw new Error(validation.message ?? 'Filtros inválidos.')

  const rawRows = await fetchCommunicationBlRows()
  const baseRows = rawRows.flatMap((row) => {
    const candidate = toBaseCandidate(row)
    return candidate ? [candidate] : []
  })
  const voyageIds = [...new Set(baseRows.map((row) => row.voyageId))]
  const schedulesByVoyage = input.kind === 'institucional' || input.kind === 'livre' || input.kind === 'aviso_chegada_noa' || input.kind === 'aviso_prontidao_nor' || input.kind === 'aviso_atracacao_nob'
    ? await listVoyageEscalaSchedulesByVoyageIds(voyageIds)
    : new Map<number, VoyageEscalaSchedule[]>()
  const operationalKind = input.filters.mode === 'institucional' ? 'aviso_chegada_noa' : input.kind
  const expanded = expandCandidatesForKind(baseRows, schedulesByVoyage, operationalKind)
  const filtered = filterCustomerCommunicationBls(expanded, input.filters)
  const customerIds = [...new Set(filtered.map((row) => row.customerId))]
  const [{ contactsByCustomer, preferences }, { data: portalSuppressions, error: portalError }, { data: communicationSuppressions, error: communicationError }] = await Promise.all([
    fetchCommunicationContacts(customerIds),
    supabase.from('portal_suppressed_emails').select('email, reason'),
    supabase.from('customer_communication_suppressions').select('email, reason'),
  ])
  if (portalError) throw portalError
  if (communicationError) throw communicationError
  const history = await fetchCommunicationHistory(customerIds, input.kind)

  return buildCustomerCommunicationConference({
    kind: input.kind,
    nature: input.nature,
    mode: input.filters.mode,
    candidates: filtered,
    contactsByCustomer,
    preferences,
    portalSuppressions: portalSuppressions ?? [],
    communicationSuppressions: communicationSuppressions ?? [],
    history,
    now: input.now,
  })
}

export type CustomerCommunicationAttemptHistory = {
  id: number
  recipient_masked: string
  status: string
  retry_count: number
  provider_message_id: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type CustomerCommunicationAttachmentHistory = {
  id: number
  file_name: string
  mime_type: string
  storage_path: string
  size_bytes: number
  created_at: string
}

export type CustomerCommunicationHistoryItem = {
  id: number
  customer_id: number
  kind: string
  nature: string
  anchor_voyage_id: number | null
  anchor_port: string | null
  anchor_atracacao_id: string | null
  anchor_invoice_id: number | null
  attempt_discriminator: number
  status: string
  dispatch_id: string | null
  vessel_name: string | null
  voyage_number: string | null
  terminal_name: string | null
  created_by: string | null
  created_at: string
  customer: { id: number; name: string; cnpj_cpf: string } | null
  attempts: CustomerCommunicationAttemptHistory[]
  bl_links: Array<{ bl_id: string }>
  attachments: CustomerCommunicationAttachmentHistory[]
}

export type CustomerCommunicationSavedTemplate = {
  id: number
  name: string
  subject: string
  body: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function fetchCustomerCommunicationSavedTemplates(): Promise<CustomerCommunicationSavedTemplate[]> {
  const result = await (supabase.rpc as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: CustomerCommunicationSavedTemplate[] | null; error: unknown }>)(
    'list_customer_communication_saved_templates',
  )
  if (result.error) throw result.error
  return result.data ?? []
}

export async function saveCustomerCommunicationSavedTemplate(input: { name: string; subject: string; body: string }): Promise<number> {
  const result = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: number | null; error: unknown }>)(
    'save_customer_communication_saved_template',
    { p_name: input.name, p_subject: input.subject, p_body: input.body },
  )
  if (result.error) throw result.error
  if (result.data == null) throw new Error('Não foi possível salvar o modelo.')
  return result.data
}

const COMMUNICATION_HISTORY_SELECT = 'id, customer_id, kind, nature, anchor_voyage_id, anchor_port, anchor_atracacao_id, anchor_invoice_id, attempt_discriminator, status, dispatch_id, vessel_name, voyage_number, terminal_name, created_by, created_at, customer:customers(id, name, cnpj_cpf), attempts:customer_communication_attempts(id, recipient_masked, status, retry_count, provider_message_id, last_error, created_at, updated_at), bl_links:customer_communication_bls(bl_id), attachments:customer_communication_attachments(id, file_name, mime_type, storage_path, size_bytes, created_at)'

export async function fetchCustomerCommunicationHistory(customerId?: number): Promise<CustomerCommunicationHistoryItem[]> {
  let query = supabase.from('customer_communications').select(COMMUNICATION_HISTORY_SELECT).order('created_at', { ascending: false }).limit(200)
  if (customerId != null) query = query.eq('customer_id', customerId)
  const { data, error } = await query.overrideTypes<CustomerCommunicationHistoryItem[], { merge: false }>()
  if (error) throw error
  return (data ?? []).map((item) => ({
    ...item,
    attempts: item.attempts ?? [],
    bl_links: item.bl_links ?? [],
    attachments: item.attachments ?? [],
  }))
}

export async function fetchBlCommunicationHistory(blId: string): Promise<CustomerCommunicationHistoryItem[]> {
  const { data: links, error: linksError } = await supabase
    .from('customer_communication_bls')
    .select('communication_id')
    .eq('bl_id', blId)
  if (linksError) throw linksError
  const communicationIds = (links ?? []).map((link) => link.communication_id)
  if (!communicationIds.length) return []
  const { data, error } = await supabase
    .from('customer_communications')
    .select(COMMUNICATION_HISTORY_SELECT)
    .in('id', communicationIds)
    .order('created_at', { ascending: false })
    .overrideTypes<CustomerCommunicationHistoryItem[], { merge: false }>()
  if (error) throw error
  return (data ?? []).map((item) => ({
    ...item,
    attempts: item.attempts ?? [],
    bl_links: item.bl_links ?? [],
    attachments: item.attachments ?? [],
  }))
}

export function customerCommunicationStatusLabel(status: string): string {
  if (status === 'enviado') return 'Enviado'
  if (status === 'simulado') return 'Simulado'
  if (status === 'falha') return 'Falha'
  return status
}

export function customerCommunicationKindLabel(kind: string): string {
  if (kind === 'aviso_chegada_noa') return 'NOA · Aviso de Chegada'
  if (kind === 'aviso_prontidao_nor') return 'NOR · Prontidão de Descarga'
  if (kind === 'aviso_atracacao_nob') return 'NOB · Atracação e Operação'
  if (kind === 'ce_mercante_taxas') return 'CE Mercante · Taxas Locais'
  if (kind === 'cobranca_demurrage') return 'Cobrança de Demurrage'
  if (kind === 'institucional') return 'Institucional'
  if (kind === 'livre') return 'Comunicado livre'
  return kind
}
