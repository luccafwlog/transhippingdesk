import type { Alert } from '../types/database'
import { supabase } from './supabase'
import { reportBestEffortFailure } from '../lib/telemetry'
import { AGENCY_REPORT_DEPARTMENT_LABELS, agencyReportSectionLabel } from './agencyDepartureReport'

export type { Alert }

export type AlertStatusFilter = 'all' | 'active' | 'dismissed'

export type AlertTypeCarrier = {
  type: string
  item_type?: string | null
}

export function getEffectiveAlertType(alert: AlertTypeCarrier): string {
  return alert.item_type ?? alert.type
}

export type AlertAudience = 'documentacao' | 'equipamentos' | 'operacoes'
export type AlertEventUnit = 'bl' | 'invoice' | 'pix_transaction' | 'demurrage_invoice'

// E3 owns audience, severity and destination in alert_type_catalog. This
// client-side contract only describes the concrete occurrence each producer
// sends to the foundation; it never creates a second notification channel.
export const FINANCIAL_ALERT_EVENTS = {
  billing_calculation_blocked: { audience: ['documentacao'], unit: 'bl' },
  billing_auto_issue_failed: { audience: ['documentacao'], unit: 'bl' },
  invoice_overdue: { audience: ['documentacao'], unit: 'invoice' },
  pix_unreconciled: { audience: ['documentacao', 'equipamentos'], unit: 'pix_transaction' },
  portal_dispute_opened: { audience: ['equipamentos'], unit: 'demurrage_invoice' },
} as const satisfies Record<string, { audience: readonly AlertAudience[]; unit: AlertEventUnit }>

// The financial panel consumes only the active financial rows from the block
// contract. Portal and Demurrage events remain available to the general alert
// queue, but are not financial alerts for `/taxas-locais`.
export const FINANCIAL_ALERT_TYPES = [
  'billing_calculation_blocked',
  'billing_auto_issue_failed',
  'invoice_overdue',
  'pix_unreconciled',
] as const

export type FinancialAlertType = typeof FINANCIAL_ALERT_TYPES[number]

// These are catalog types already consumed by browser producers elsewhere.
// The legacy `demurrage` carrier is intentionally absent: a label for a
// historical row must not become permission to create a new occurrence.
export const ACTIVE_ALERT_TYPES = [
  'billing_calculation_blocked',
  'billing_auto_issue_failed',
  'invoice_overdue',
  'pix_unreconciled',
  'portal_dispute_opened',
  'review_customer_unlinked',
  'review_customer_email_missing',
  'review_portal_not_ready',
  'review_breakbulk_weight_missing',
  'review_granite_customer_unlinked',
  'invoice_payment_invalid',
  'invoice_cancel_blocked',
  'portal_excecao_critica_fatura',
  'portal_pendencia_geral',
  'portal_convite_expirado',
  'portal_falha_envio',
  'portal_email_suprimido',
  'portal_abuso_login',
  'voyage_bl_expected',
  'voyage_baplie_missing',
  'voyage_baplie_documentary_coverage',
  'voyage_ce_mercante_missing',
  'voyage_schedule_date_pending',
  'voyage_terminal_date_pending',
  'voyage_export_after_atd',
  'agency_report_department_pending',
  'agency_report_deadline_missed',
] as const

export type ActiveAlertType = typeof ACTIVE_ALERT_TYPES[number]

export const ALERT_TYPE_LABELS: Record<string, string> = {
  invoice_overdue: 'Fatura vencida',
  invoice_payment_invalid: 'Pagamento inválido',
  invoice_cancel_blocked: 'Cancelamento bloqueado',
  portal_invoice_created: 'Fatura criada no portal',
  portal_consolidation_obsoleted: 'Consolidada obsoleta (portal)',
  // Historical carrier only; it is not part of ActiveAlertType.
  demurrage: 'Demurrage',
  billing_calculation_blocked: 'Cálculo local bloqueado',
  billing_auto_issue_failed: 'Falha de emissão local',
  pix_unreconciled: 'PIX sem conciliação segura',
  portal_dispute_opened: 'Disputa de invoice Demurrage',
  portal_pendencia_geral: 'Portal do Cliente — pendência geral',
  portal_excecao_critica_fatura: 'Portal do Cliente — exceção crítica de invoice',
  portal_convite_expirado: 'Portal do Cliente — convite expirado',
  portal_falha_envio: 'Portal do Cliente — falha de envio',
  portal_email_suprimido: 'Portal do Cliente — email suprimido',
  portal_abuso_login: 'Portal do Cliente — abuso de login',
  review_customer_unlinked: 'Revisão — cliente não vinculado',
  review_customer_email_missing: 'Revisão — email do cliente ausente',
  review_portal_not_ready: 'Revisão — Portal não pronto',
  review_breakbulk_weight_missing: 'Revisão — peso de carga solta ausente',
  review_granite_customer_unlinked: 'Revisão — cliente de Granito não vinculado',
  voyage_bl_expected: 'Viagem — B/L esperado',
  voyage_baplie_missing: 'Viagem — Baplie ausente',
  voyage_baplie_documentary_coverage: 'Viagem — cobertura documental do Baplie',
  voyage_ce_mercante_missing: 'Viagem — CE Mercante ausente',
  voyage_schedule_date_pending: 'Viagem — data de escala pendente',
  voyage_terminal_date_pending: 'Viagem — data do terminal pendente',
  voyage_export_after_atd: 'Viagem — exportação após ATD',
  agency_report_department_pending: 'ADR — departamento pendente',
  agency_report_deadline_missed: 'ADR — prazo vencido',
}

export function getAlertTypeLabel(type: string): string {
  return ALERT_TYPE_LABELS[type] ?? type
}

export function alertEntityLink(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  metadata?: Record<string, unknown>
}): string | null {
  if (!alert.entity_id) return null
  const effectiveType = getEffectiveAlertType(alert)
  if (effectiveType === 'portal_excecao_critica_fatura' && alert.entity_type === 'bl') {
    return `/manifestos/${encodeURIComponent(alert.entity_id)}?tab=faturamento`
  }
  if (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed') {
    return '/taxas-locais'
  }
  if (alert.entity_type === 'pix_transaction') return '/reconciliacao'
  if (effectiveType === 'portal_dispute_opened' && alert.entity_type === 'demurrage_invoice') {
    return '/demurrage'
  }
  if (effectiveType.startsWith('portal_')) {
    if (alert.entity_type === 'invoice') return invoiceLink(alert)
    return `/clientes/portal?cliente=${encodeURIComponent(alert.entity_id)}`
  }
  if (alert.entity_type === 'invoice') return invoiceLink(alert)
  if (alert.entity_type === 'container') return `/demurrage?busca=${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'bl') return `/manifestos/${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'demurrage_invoice') return '/demurrage'
  if (alert.entity_type === 'agency_departure_report') {
    const [voyageId, port, terminalOrLegacyKey, terminalizedKey] = alert.entity_id.split('::')
    if (!/^\d+$/.test(voyageId)) return null
    const params = new URLSearchParams({ tab: 'adr', escala: port })
    if (terminalizedKey !== undefined) params.set('terminal', terminalOrLegacyKey)
    return `/viagens/${voyageId}?${params.toString()}`
  }
  if (alert.entity_type === 'voyage' && /^\d+$/.test(alert.entity_id)) return `/viagens/${alert.entity_id}`
  return null
}

export function alertEntityLinkLabel(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
}): string {
  const effectiveType = getEffectiveAlertType(alert)
  if (alert.entity_type === 'bl' && (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')) {
    return 'Taxas Locais'
  }
  if (alert.entity_type === 'invoice') return 'Ver Fatura'
  if (alert.entity_type === 'demurrage_invoice') return 'Ver Demurrage'
  if (alert.entity_type === 'container') return 'Ver Demurrage'
  if (alert.entity_type === 'bl') return 'Abrir B/L'
  if (alert.entity_type === 'agency_departure_report' || alert.entity_type === 'voyage') return 'Abrir Viagem'
  return 'Abrir'
}

function invoiceLink(alert: { entity_id: string | null; metadata?: Record<string, unknown> }): string {
  if (!alert.entity_id) return '/taxas-locais'
  const metadataInvoiceId = alert.metadata?.invoice_id
  const invoiceId = typeof metadataInvoiceId === 'number' && Number.isInteger(metadataInvoiceId) && metadataInvoiceId > 0
    ? String(metadataInvoiceId)
    : typeof metadataInvoiceId === 'string' && /^\d+$/.test(metadataInvoiceId)
      ? metadataInvoiceId
      : /^\d+$/.test(alert.entity_id)
        ? alert.entity_id
        : null
  return invoiceId ? `/taxas-locais?invoice=${encodeURIComponent(invoiceId)}` : '/taxas-locais'
}

export type AlertQueueRow = Alert & {
  item_type?: string | null
  item_id: number | null
  item_status: 'active' | 'resolved' | null
  severity: 'normal' | 'critical'
  department: string | null
  destination: string | null
  dismissed_until: string | null
  metadata: Record<string, unknown>
}

type AlertsRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

// database.ts is generated and protected by the repository. New foundation
// RPCs are kept behind this narrow boundary until the next generated type
// refresh, instead of weakening the rest of the Supabase client.
const alertsRpc = supabase as unknown as AlertsRpcClient

// entity_id dos alertas do ADR é composto (voyageId::porto::departamento,
// migration 225; secao em alertas legados pre-0029) ou terminalizado
// (voyageId::porto::terminal::departamento/secao). Este formatador é só
// apresentação para a página Alertas.
export function formatAgencyReportAlertEntity(entityId: string): string | null {
  const [voyageId, port, terminalOrKey, maybeKey] = entityId.split('::')
  const terminalized = maybeKey !== undefined
  const key = terminalized ? maybeKey : terminalOrKey
  if (!voyageId || !port || !key) return null
  const label = (AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[key]
    ?? agencyReportSectionLabel(key)
  return terminalized
    ? `Viagem ${voyageId} · ${port} · Terminal ${terminalOrKey} · ${label}`
    : `Viagem ${voyageId} · ${port} · ${label}`
}

export async function listAlerts(statusFilter: AlertStatusFilter = 'all', entityType?: string): Promise<AlertQueueRow[]> {
  const { data, error } = await alertsRpc.rpc('list_alert_queue', {
    p_filter: statusFilter,
    ...(entityType ? { p_entity_type: entityType } : {}),
  })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as AlertQueueRow[]
}

export async function countAlertQueue(statusFilter: AlertStatusFilter = 'active'): Promise<number> {
  const { data, error } = await alertsRpc.rpc('count_alert_queue', { p_filter: statusFilter })
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}

export async function dismissAlertItem(itemId: number, reason: string, reviewAt: string): Promise<void> {
  const { error } = await alertsRpc.rpc('dismiss_alert_item', {
    p_item_id: itemId,
    p_reason: reason,
    p_review_at: reviewAt,
  })
  if (error) throw error
}

// Kept as a compatibility export for old financial consumers while the
// block-specific migrations move their origin resolvers to resolve_alert_item.
// The Alertas UI has no manual close/reconhecimento path anymore.
export async function acknowledgeAlert(_id: number): Promise<void> {
  void _id
  throw new Error('Reconhecimento de alertas não existe mais. Leia a Notificação Interna ou dispense o item.')
}

export async function closeAlert(_id: number): Promise<void> {
  void _id
  throw new Error('Alertas derivados são fechados automaticamente pela origem.')
}

export async function createAlert(input: {
  type: ActiveAlertType
  entityType: string
  entityId: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await alertsRpc.rpc('upsert_alert_item', {
    p_type: input.type,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_message: input.message,
    p_source: 'client_compatibility',
    p_metadata: input.metadata ?? {},
  })
  if (error) reportBestEffortFailure('criar item de alerta', error, { type: input.type })
}

export async function resolveAlertItem(input: {
  type: ActiveAlertType
  entityType: string
  entityId: string
  source?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { error } = await alertsRpc.rpc('resolve_alert_item', {
    p_type: input.type,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_source: input.source ?? 'client_compatibility',
    p_metadata: input.metadata ?? {},
  })
  if (error) reportBestEffortFailure('resolver item de alerta', error, { type: input.type })
}

export async function listFinancialAlerts(): Promise<AlertQueueRow[]> {
  const financialEntityTypes = ['bl', 'invoice', 'pix_transaction'] as const
  const financialTypes = new Set<string>(FINANCIAL_ALERT_TYPES)
  const alertsByEntityType = await Promise.all(
    financialEntityTypes.map((entityType) => listAlerts('active', entityType)),
  )
  const uniqueAlerts = new Map<string, AlertQueueRow>()

  for (const alerts of alertsByEntityType) {
    for (const alert of alerts) {
      const effectiveType = getEffectiveAlertType(alert)
      const expectedEntityType = FINANCIAL_ALERT_EVENTS[effectiveType as keyof typeof FINANCIAL_ALERT_EVENTS]?.unit
      if (!financialTypes.has(effectiveType) || expectedEntityType !== alert.entity_type) continue
      const occurrenceKey = [
        alert.id,
        alert.item_id ?? 'legacy',
        effectiveType,
        alert.entity_type,
        alert.entity_id,
      ].join(':')
      uniqueAlerts.set(occurrenceKey, alert)
    }
  }

  return Array.from(uniqueAlerts.values()).sort((left, right) => {
    const createdAtDifference = Date.parse(right.created_at ?? '') - Date.parse(left.created_at ?? '')
    if (Number.isFinite(createdAtDifference) && createdAtDifference !== 0) return createdAtDifference
    return Number(right.id) - Number(left.id) || Number(right.item_id ?? 0) - Number(left.item_id ?? 0)
  })
}

// Deprecated browser compatibility. The only production scheduler is the
// server-only alerts-detector Edge Function from migration 319.
export async function detectOverdueInvoices(): Promise<void> {
  const { error } = await supabase.rpc('detect_overdue_invoices')
  if (error) throw error
}

export async function detectAgencyReportPending(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_pending')
  if (error) throw error
}

export async function detectAgencyReportDeadlineMissed(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_deadline_missed')
  if (error) throw error
}

export type InternalNotification = {
  id: number
  alert_id: number
  alert_item_id: number
  item_type: string
  severity: 'normal' | 'critical'
  title: string
  message: string
  entity_type: string | null
  entity_id: string | null
  destination: string | null
  is_fallback: boolean
  read_at: string | null
  created_at: string
  payload: Record<string, unknown>
}

export async function listInternalNotifications(includeRead = false): Promise<InternalNotification[]> {
  const { data, error } = await alertsRpc.rpc('list_internal_notifications', { p_include_read: includeRead })
  if (error) throw error
  return (Array.isArray(data) ? data : []) as InternalNotification[]
}

export async function markInternalNotificationRead(notificationId: number): Promise<void> {
  const { error } = await alertsRpc.rpc('mark_internal_notification_read', { p_notification_id: notificationId })
  if (error) throw error
}
