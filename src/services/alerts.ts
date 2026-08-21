import { supabase } from './supabase'
import type { Alert } from '../types/database'
import { reportBestEffortFailure } from '../lib/telemetry'

// Catálogo vivo de alertas suportados pela aplicação.
export type ActiveAlertType =
  | 'invoice_overdue'
  | 'invoice_payment_invalid'
  | 'invoice_cancel_blocked'
  | 'portal_invoice_created'
  | 'portal_consolidation_obsoleted'
  | 'portal_dispute_opened'
  | 'demurrage'
  | 'pix_unreconciled'
  | 'billing_calculation_blocked'
  | 'billing_auto_issue_failed'
  | 'portal_pendencia_geral'
  | 'portal_excecao_critica_fatura'
  | 'portal_reprocessamento_falhou'
  | 'portal_convite_expirado'
  | 'portal_falha_envio'
  | 'portal_email_suprimido'
  | 'portal_abuso_login'
  | 'agency_report_department_pending'
  | 'agency_report_deadline_missed'
  | 'review_customer_unlinked'
  | 'review_customer_email_missing'
  | 'review_portal_not_ready'
  | 'review_breakbulk_weight_missing'
  | 'review_granite_customer_unlinked'
  | 'voyage_bl_expected'
  | 'voyage_baplie_missing'
  | 'voyage_baplie_documentary_coverage'
  | 'voyage_ce_mercante_missing'
  | 'voyage_schedule_date_pending'
  | 'voyage_terminal_date_pending'
  | 'voyage_export_after_atd'

export const TYPE_LABELS: Record<string, string> = {
  invoice_overdue: 'Fatura vencida',
  invoice_payment_invalid: 'Pagamento inválido',
  invoice_cancel_blocked: 'Cancelamento bloqueado',
  portal_invoice_created: 'Fatura criada no portal',
  portal_consolidation_obsoleted: 'Consolidada obsoleta (portal)',
  portal_dispute_opened: 'Disputa de invoice Demurrage',
  demurrage: 'Demurrage',
  pix_unreconciled: 'PIX sem conciliação segura',
  billing_calculation_blocked: 'Cálculo bloqueado',
  billing_auto_issue_failed: 'Falha de emissão automática',
  portal_pendencia_geral: 'Portal do Cliente — pendência geral',
  portal_excecao_critica_fatura: 'Portal do Cliente — exceção de fatura',
  portal_reprocessamento_falhou: 'Portal do Cliente — falha no reprocessamento',
  portal_convite_expirado: 'Portal do Cliente — convite expirado',
  portal_falha_envio: 'Portal do Cliente — falha de envio',
  portal_email_suprimido: 'Portal do Cliente — email suprimido',
  portal_abuso_login: 'Portal do Cliente — abuso de login',
  agency_report_department_pending: 'ADR — departamento pendente',
  agency_report_deadline_missed: 'ADR — prazo vencido',
  review_customer_unlinked: 'Revisão de B/L — cliente não vinculado',
  review_customer_email_missing: 'Revisão de B/L — cliente sem e-mail',
  review_portal_not_ready: 'Revisão de B/L — Portal não provisionado',
  review_breakbulk_weight_missing: 'Revisão de B/L — peso BB ausente',
  review_granite_customer_unlinked: 'Revisão de Granito — cliente não vinculado',
  voyage_bl_expected: 'B/L esperado pendente',
  voyage_baplie_missing: 'Baplie ausente',
  voyage_baplie_documentary_coverage: 'Cobertura Baplie / B/L',
  voyage_ce_mercante_missing: 'CE Mercante pendente',
  voyage_schedule_date_pending: 'Data da escala pendente',
  voyage_terminal_date_pending: 'Data de terminal pendente',
  voyage_export_after_atd: 'Exportação pendente pós-ATD',
}

export type AlertAudience = 'documentacao' | 'equipamentos' | 'operacoes'
export type AlertEventUnit = 'bl' | 'invoice' | 'pix_transaction' | 'demurrage_invoice'

export const FINANCIAL_ALERT_EVENTS = {
  billing_calculation_blocked: { audience: ['documentacao'], unit: 'bl' },
  billing_auto_issue_failed: { audience: ['documentacao'], unit: 'bl' },
  invoice_overdue: { audience: ['documentacao'], unit: 'invoice' },
  pix_unreconciled: { audience: ['documentacao', 'equipamentos'], unit: 'pix_transaction' },
  portal_dispute_opened: { audience: ['equipamentos'], unit: 'demurrage_invoice' },
} as const satisfies Record<string, { audience: readonly AlertAudience[]; unit: AlertEventUnit }>

export const FINANCIAL_ALERT_TYPES = [
  'billing_calculation_blocked',
  'billing_auto_issue_failed',
  'invoice_overdue',
  'pix_unreconciled',
] as const

export type FinancialAlertType = typeof FINANCIAL_ALERT_TYPES[number]

import { AGENCY_REPORT_DEPARTMENT_LABELS, agencyReportSectionLabel } from './agencyDepartureReport'

function isTerminalCode(value: string | undefined): boolean {
  return Boolean(value && /^[A-Z0-9][A-Z0-9._-]*$/.test(value))
}

function isTerminalizedAgencyReportKey(value: string | undefined, metadata: Record<string, unknown> = {}): boolean {
  const metadataTerminal = metadata.terminal_code
  return (typeof metadataTerminal === 'string' && metadataTerminal.trim().length > 0)
    || isTerminalCode(value)
}

export function formatAgencyReportAlertEntity(entityId: string): string | null {
  const parts = entityId.split('::')
  const [voyageId, port, third, fourth] = parts
  if (!voyageId || !port || parts.length < 2 || parts.length > 4) return null
  if (parts.length === 2) return `Viagem ${voyageId} · ${port}`

  const terminalized = parts.length === 4 || (parts.length === 3 && isTerminalizedAgencyReportKey(third))
  if (terminalized) {
    const terminalLabel = parts.length === 4 && fourth
      ? ` · ${((AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[fourth] ?? agencyReportSectionLabel(fourth))}`
      : ''
    return `Viagem ${voyageId} · ${port} · Terminal ${third}${terminalLabel}`
  }

  const label = (AGENCY_REPORT_DEPARTMENT_LABELS as Record<string, string>)[third]
    ?? agencyReportSectionLabel(third)
  return `Viagem ${voyageId} · ${port} · ${label}`
}

export function formatAlertEntity(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null
  if (entityType === 'agency_departure_report') {
    return formatAgencyReportAlertEntity(entityId)
  }
  if (entityType === 'voyage') {
    return `Viagem ${entityId}`
  }
  if (entityType === 'voyage_pod_schedule') {
    const [voyageId, port] = entityId.split('::')
    return port ? `Viagem ${voyageId} · Escala ${port}` : `Escala ${entityId}`
  }
  if (entityType === 'voyage_escala_terminal') {
    const [voyageId, port, terminalId] = entityId.split('::')
    return terminalId ? `Viagem ${voyageId} · ${port} · Terminal ${terminalId}` : `Terminal ${entityId}`
  }
  return null
}

export function agencyReportAlertLink(
  entityId: string,
  metadata: Record<string, unknown> = {},
): string | null {
  const parts = entityId.split('::')
  const [voyageId, port, third] = parts
  if (!/^\d+$/.test(voyageId ?? '') || !port || parts.length < 2 || parts.length > 4) return null

  const params = new URLSearchParams({ tab: 'adr', escala: port })
  const terminal = parts.length === 4 || (parts.length === 3 && isTerminalizedAgencyReportKey(third, metadata))
    ? third
    : undefined
  if (terminal) params.set('terminal', terminal)
  const reportId = metadata.report_id
  if (typeof reportId === 'string' && reportId.length > 0) params.set('report', reportId)
  return `/viagens/${voyageId}?${params.toString()}`
}

export function getEffectiveAlertType(alert: {
  type: string
  item_type?: string | null
}): string {
  return alert.item_type ?? alert.type
}

export function getAlertTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

export function alertEntityLink(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  metadata?: Record<string, unknown> | null
}): string | null {
  if (!alert.entity_id) return null
  const effectiveType = getEffectiveAlertType(alert)

  if (
    (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')
    && alert.entity_type === 'bl'
  ) {
    const correctionRoute = alert.metadata?.correction_route
    const hasControlCharacter = typeof correctionRoute === 'string'
      && Array.from(correctionRoute).some((character) => {
        const code = character.charCodeAt(0)
        return code < 0x20 || code === 0x7f
      })
    if (
      effectiveType === 'billing_calculation_blocked'
      && typeof correctionRoute === 'string'
      && correctionRoute.startsWith('/')
      && !correctionRoute.startsWith('//')
      && !correctionRoute.includes('\\')
      && !hasControlCharacter
      && !/^[^/]+:\/\//.test(correctionRoute)
    ) {
      return correctionRoute
    }
    return '/taxas-locais'
  }

  if (alert.entity_type === 'pix_transaction') return '/reconciliacao'
  if (effectiveType === 'portal_dispute_opened' && alert.entity_type === 'demurrage_invoice') {
    const disputeId = alert.metadata?.dispute_id
    return typeof disputeId === 'string' || typeof disputeId === 'number'
      ? `/demurrage?dispute=${encodeURIComponent(String(disputeId))}`
      : '/demurrage'
  }
  if (
    (effectiveType === 'portal_excecao_critica_fatura' || effectiveType === 'portal_reprocessamento_falhou')
    && alert.entity_type === 'bl'
  ) {
    return `/manifestos/${encodeURIComponent(alert.entity_id)}?tab=faturamento`
  }
  if (effectiveType.startsWith('portal_')) {
    if (alert.entity_type === 'invoice') return invoiceLink(alert)
    return `/clientes/portal?cliente=${encodeURIComponent(alert.entity_id)}`
  }
  if (alert.entity_type === 'invoice') return invoiceLink(alert)
  if (alert.entity_type === 'container') return `/demurrage?busca=${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'bl') return `/manifestos/${encodeURIComponent(alert.entity_id)}`
  if (alert.entity_type === 'granite_bl') return '/granito'
  if (alert.entity_type === 'demurrage_invoice') return '/demurrage'
  if (alert.entity_type === 'agency_departure_report') {
    return agencyReportAlertLink(alert.entity_id, alert.metadata ?? undefined)
  }
  if (alert.entity_type === 'voyage') {
    if (alert.type.startsWith('voyage_baplie_')) {
      return `/baplie?voyage=${encodeURIComponent(alert.entity_id)}`
    }
    if (/^\d+$/.test(alert.entity_id)) return `/viagens/${encodeURIComponent(alert.entity_id)}`
    return '/viagens'
  }
  if (alert.entity_type === 'voyage_pod_schedule') {
    const [voyageId, port] = alert.entity_id.split('::')
    if (!/^\d+$/.test(voyageId)) return '/viagens'
    const params = new URLSearchParams()
    if (port) params.set('escala', port)
    return `/viagens/${voyageId}${params.toString() ? `?${params.toString()}` : ''}`
  }
  if (alert.entity_type === 'voyage_escala_terminal') {
    const [voyageId, port, terminalId] = alert.entity_id.split('::')
    if (!/^\d+$/.test(voyageId)) return '/viagens'
    const params = new URLSearchParams()
    if (port) params.set('escala', port)
    if (terminalId) params.set('terminal', terminalId)
    return `/viagens/${voyageId}${params.toString() ? `?${params.toString()}` : ''}`
  }
  return null
}

export function alertEntityLinkLabel(alert: {
  type: string
  item_type?: string | null
  entity_type: string | null
}): string {
  const effectiveType = getEffectiveAlertType(alert)
  if (alert.type.startsWith('voyage_baplie_')) return 'Abrir Baplie'
  if (alert.entity_type === 'bl' && (effectiveType === 'billing_calculation_blocked' || effectiveType === 'billing_auto_issue_failed')) {
    return 'Taxas Locais'
  }
  if (alert.entity_type === 'pix_transaction') return 'Abrir Reconciliação'
  if (alert.entity_type === 'invoice') return 'Ver Fatura'
  if (alert.entity_type === 'demurrage_invoice') return 'Ver Demurrage'
  if (alert.entity_type === 'container') return 'Ver Demurrage'
  if (alert.entity_type === 'bl') return 'Abrir B/L'
  if (alert.entity_type === 'granite_bl') return 'Abrir Granito'
  if (
    alert.entity_type === 'agency_departure_report' ||
    alert.entity_type === 'voyage' ||
    alert.entity_type === 'voyage_pod_schedule' ||
    alert.entity_type === 'voyage_escala_terminal'
  ) {
    return 'Abrir Viagem'
  }
  return 'Abrir'
}

function invoiceLink(alert: { entity_id: string | null; metadata?: Record<string, unknown> | null }): string {
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
  target_route: string | null
  dismissed_until: string | null
  dismissal_reason: string | null
  dismissed_by: string | null
  resolved_at: string | null
  resolved_by: string | null
  resolution_source: string | null
  payload: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

export type AlertStatusFilter = 'all' | 'active' | 'dismissed'

const alertsRpc = supabase as unknown as {
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>
}

export async function dismissAlertItem(
  itemId: number,
  reason: string,
  reviewAt: string,
): Promise<void> {
  const { error } = await alertsRpc.rpc('dismiss_alert_item', {
    p_item_id: itemId,
    p_reason: reason,
    p_review_at: reviewAt,
  })
  if (error) throw error
}

export async function closeAlert(_id: number): Promise<void> {
  void _id
  throw new Error('Fechamento direto de alertas foi descontinuado na migração 318. Resolva a pendência na tela de origem ou use dismiss.')
}

export async function createAlert(input: {
  type: ActiveAlertType
  entityType: string
  entityId: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  if (input.type !== 'billing_calculation_blocked' && input.type !== 'billing_auto_issue_failed') {
    throw new Error(`Produtor de alerta não permitido no browser: ${input.type}`)
  }
  const { error } = await alertsRpc.rpc('upsert_billing_alert', {
    p_type: input.type,
    p_bl_id: input.entityId,
    p_message: input.message,
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
  if (input.type !== 'billing_calculation_blocked' && input.type !== 'billing_auto_issue_failed') {
    throw new Error(`Resolvedor de alerta não permitido no browser: ${input.type}`)
  }
  const { error } = await alertsRpc.rpc('resolve_billing_alert', {
    p_type: input.type,
    p_bl_id: input.entityId,
    p_metadata: input.metadata ?? {},
  })
  if (error) reportBestEffortFailure('resolver item de alerta', error, { type: input.type })
}

export async function listFinancialAlerts(): Promise<AlertQueueRow[]> {
  const financialEntityTypes = ['bl', 'invoice', 'pix_transaction'] as const
  const financialTypes = new Set<string>(FINANCIAL_ALERT_TYPES)
  const alertsByEntityType = await Promise.all(financialEntityTypes.map(async (entityType) => {
    const rows: AlertQueueRow[] = []
    for (let page = 0; ; page += 1) {
      const batch = await listAlerts('active', entityType, page)
      rows.push(...batch)
      if (batch.length < 100) break
    }
    return rows
  }))
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

  return Array.from(uniqueAlerts.values())
    .sort((left, right) => {
      const createdAtDifference = Date.parse(right.created_at ?? '') - Date.parse(left.created_at ?? '')
      if (Number.isFinite(createdAtDifference) && createdAtDifference !== 0) return createdAtDifference
      return Number(right.id) - Number(left.id) || Number(right.item_id ?? 0) - Number(left.item_id ?? 0)
    })
    .slice(0, 200)
}

export async function detectAgencyReportPending(): Promise<void> {
  const { error } = await supabase.rpc('detect_agency_report_pending')
  if (error) throw error
}

export async function listAlerts(statusFilter: AlertStatusFilter = 'all', entityType?: string, page = 0): Promise<AlertQueueRow[]> {
  const { data, error } = await alertsRpc.rpc('list_alert_queue_page', {
    p_filter: statusFilter,
    p_entity_type: entityType ?? null,
    p_offset: page * 100,
    p_limit: 100,
  })
  if (error) throw error
  return (data as AlertQueueRow[]) ?? []
}

export async function countAlertQueue(statusFilter: AlertStatusFilter = 'active'): Promise<number> {
  const { data, error } = await alertsRpc.rpc('count_alert_queue', { p_filter: statusFilter })
  if (error) throw error
  return typeof data === 'number' ? data : Number(data ?? 0)
}

export type InternalNotification = {
  id: number
  item_id: number
  type: string
  item_type?: string | null
  entity_type: string | null
  entity_id: string | null
  title?: string
  message: string
  severity: 'normal' | 'critical'
  destination?: string | null
  read_at: string | null
  created_at: string
  payload?: Record<string, unknown> | null
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
